import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  api,
  ApiClientError,
  type AnalysisJob,
  type AnalysisResult,
  type ParticipantSessionSummary,
  type Project,
  type StudyDraft,
  type StudyDraftResponse,
} from "./api";
import { ParticipantRunner, participantTokenFromPath } from "./ParticipantRunner";
import { ExperimentalEyeTracking } from "./ExperimentalEyeTracking";
import { buildHeatmap, gazeSamplesForSnapshot, parseCollectorArtifact, type CollectorArtifact } from "./collectorArtifact";
import { syntheticCollectorReplay } from "./demoCollectorArtifact";

const emptyDraft: StudyDraft = {
  title: "Accessible checkout attention study",
  description: "Understand how first-time visitors scan pricing and begin checkout.",
  consent_version: "demo-v1",
  consent_text:
    "I consent to webcam-based gaze estimation for this synthetic UX research demo.",
  target_origins: ["https://demo.example.com"],
  calibration_policy: {
    minimum_quality: "variable",
    allow_retry: true,
    maximum_attempts: 3,
  },
  collection_policy: { screenshots_enabled: false, sample_interval_ms: 100, webcam_gaze_enabled: false },
  retention_days: 30,
  tasks: [
    {
      position: 1,
      title: "Find pricing",
      prompt: "Find the plan that best fits a small research team.",
      start_url: "https://demo.example.com/pricing",
      success_url_pattern: "/checkout",
      time_limit_ms: 120000,
      areas_of_interest: [],
    },
  ],
};

type Notice = { kind: "success" | "error"; text: string } | null;

type TaskAggregate = {
  position: number;
  title: string;
  sessionCount: number;
  sampleCount: number;
  meanConfidence: number | null;
};

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function aggregateTaskMetrics(results: AnalysisResult[]): TaskAggregate[] {
  const buckets = new Map<number, {
    title: string;
    sessionCount: number;
    sampleCount: number;
    confidenceTotal: number;
    confidenceWeight: number;
  }>();

  for (const result of results) {
    const metrics = (result.task_metrics.tasks as Array<Record<string, unknown>> | undefined) ?? [];
    for (const metric of metrics) {
      const position = numberValue(metric.task_position);
      if (position === null) continue;
      const sampleCount = numberValue(metric.sample_count) ?? 0;
      const confidence = numberValue(metric.mean_confidence);
      const bucket = buckets.get(position) ?? {
        title: String(metric.task_title ?? `Task ${position}`),
        sessionCount: 0,
        sampleCount: 0,
        confidenceTotal: 0,
        confidenceWeight: 0,
      };
      bucket.sessionCount += 1;
      bucket.sampleCount += sampleCount;
      if (confidence !== null) {
        const weight = sampleCount || 1;
        bucket.confidenceTotal += confidence * weight;
        bucket.confidenceWeight += weight;
      }
      buckets.set(position, bucket);
    }
  }

  return [...buckets.entries()]
    .sort(([first], [second]) => first - second)
    .map(([position, bucket]) => ({
      position,
      title: bucket.title,
      sessionCount: bucket.sessionCount,
      sampleCount: bucket.sampleCount,
      meanConfidence: bucket.confidenceWeight
        ? bucket.confidenceTotal / bucket.confidenceWeight
        : null,
    }));
}

export function App() {
  if (window.location.pathname === "/experimental/eye-tracking") return <ExperimentalEyeTracking />;
  const token = participantTokenFromPath();
  if (token) return <ParticipantRunner token={token} />;
  return <StudyBuilder />;
}

function StudyBuilder() {
  const bootstrapStarted = useRef(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [study, setStudy] = useState<StudyDraftResponse | null>(null);
  const [draft, setDraft] = useState<StudyDraft>(emptyDraft);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [participantUrl, setParticipantUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [projectCreationOpen, setProjectCreationOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);

  useEffect(() => {
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      const projectList = await api.listProjects();
      const current =
        projectList.items[0] ?? (await api.createProject("Checkout UX research"));
      const available = projectList.items.length ? projectList.items : [current];
      setProjects(available);
      await selectProject(current);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function selectProject(nextProject: Project, isNewProject = false) {
    setBusy(true);
    setNotice(null);
    try {
      setProject(nextProject);
      setDashboardOpen(false);
      setResultsOpen(false);
      setStudy(null);
      setDraft(isNewProject ? { ...emptyDraft, title: "Untitled study", description: "" } : emptyDraft);
      setDirty(false);
      setEditing(true);
      setParticipantUrl(null);
      const studies = await api.listStudies(nextProject.id);
      if (!studies.items[0]) return;
      const existing = await api.getDraft(studies.items[0].id);
      setStudy(existing);
      setDraft(toDraft(existing));
      setEditing(existing.current_published_version === null);
      if (existing.current_published_version) {
        const link = await api.getParticipantLink(existing.id);
        setParticipantUrl(link.participant_url);
      }
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function createProject(name: string, researchQuestion?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const created = await api.createProject(name, researchQuestion);
      setProjects((current) => [created, ...current]);
      await selectProject(created, true);
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function toDraft(value: StudyDraftResponse): StudyDraft {
    return {
      title: value.title,
      description: value.description,
      consent_version: value.consent_version,
      consent_text: value.consent_text,
      target_origins: value.target_origins,
      calibration_policy: value.calibration_policy,
      collection_policy: value.collection_policy,
      retention_days: value.retention_days,
      tasks: value.tasks,
    };
  }

  function showError(error: unknown) {
    const text =
      error instanceof ApiClientError
        ? error.message
        : "Something went wrong. Try again.";
    setNotice({ kind: "error", text });
  }

  async function saveDraft() {
    if (!project) return null;
    if (study && !dirty) return study;
    setBusy(true);
    setNotice(null);
    try {
      const saved = study
        ? await api.replaceDraft(study.id, draft)
        : await api.createStudy(project.id, draft);
      setStudy(saved);
      setDraft(toDraft(saved));
      setDirty(false);
      setNotice({
        kind: "success",
        text: `Draft revision ${saved.draft_revision} saved.`,
      });
      return saved;
    } catch (error) {
      showError(error);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    const saved = await saveDraft();
    if (!saved) return;
    setBusy(true);
    try {
      const result = await api.publish(saved.id);
      setStudy({
        ...saved,
        lifecycle: result.study.lifecycle,
        current_published_version: result.version.version_number,
      });
      const newParticipantUrl = result.participant_link?.participant_url ?? participantUrl;
      setParticipantUrl(newParticipantUrl);
      setDirty(false);
      setEditing(false);
      setNotice({
        kind: "success",
        text: `Version ${result.version.version_number} published.`,
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(changes: Partial<StudyDraft>) {
    setDirty(true);
    setDraft((current) => ({ ...current, ...changes }));
  }

  function updateTask(
    index: number,
    field: "title" | "prompt" | "start_url",
    value: string,
  ) {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      tasks: current.tasks.map((task, taskIndex) =>
        taskIndex === index ? { ...task, [field]: value } : task,
      ),
    }));
  }

  function addTask() {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      tasks: [
        ...current.tasks,
        {
          position: current.tasks.length + 1,
          title: `Task ${current.tasks.length + 1}`,
          prompt: "Describe what the participant should accomplish.",
          start_url: "https://demo.example.com",
          time_limit_ms: 120000,
          areas_of_interest: [],
        },
      ],
    }));
  }

  function removeTask(index: number) {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      tasks: current.tasks
        .filter((_, taskIndex) => taskIndex !== index)
        .map((task, taskIndex) => ({ ...task, position: taskIndex + 1 })),
    }));
  }

  async function copyParticipantLink() {
    if (!participantUrl) return;
    const absoluteUrl = new URL(participantUrl, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      setNotice({
        kind: "error",
        text: "The link could not be copied. Select and copy it manually.",
      });
    }
  }

  const publishedVersion = study?.current_published_version ?? null;
  const isLocked = publishedVersion !== null && !editing;

  if (dashboardOpen) {
    if (projectCreationOpen) {
      return (
        <ProjectCreationPage
          onCancel={() => setProjectCreationOpen(false)}
          onCreateProject={createProject}
        />
      );
    }
    return (
      <ProjectDashboard
        projects={projects}
        currentProjectId={project?.id ?? null}
        onOpenProject={(nextProject) => void selectProject(nextProject)}
        onCreateProject={() => setProjectCreationOpen(true)}
      />
    );
  }

  if (resultsOpen && study) {
    return <ResultsDashboard study={study} onBack={() => setResultsOpen(false)} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="WebGaze Research home">
          <span className="brand-mark" aria-hidden="true">◉</span>
          WebGaze Research
        </a>
        <span className="environment">Independent demo</span>
      </header>

      <main>
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <button
            type="button"
            className="project-nav-button"
            onClick={() => setDashboardOpen(true)}
          >
            Projects
          </button><span>/</span>
          <strong>{project?.name ?? "Loading…"}</strong>
        </nav>

        <section className="page-heading">
          <div>
            <p className="eyebrow">Study builder</p>
            <h1>{draft.title}</h1>
            <p>
              Define a consent-aware protocol, add up to four tasks, then publish
              an immutable version.
            </p>
          </div>
          <div className="status-stack">
            <span className={`status ${dirty ? "draft" : study?.lifecycle ?? "draft"}`}>
              {editing && publishedVersion
                ? dirty
                  ? "Unpublished changes"
                  : "Editing study"
                : dirty
                ? "Unpublished changes"
                : publishedVersion
                  ? `Published · v${publishedVersion}`
                  : "Draft"}
            </span>
            <small>
              {study ? `Draft revision ${study.draft_revision}` : "Not saved yet"}
            </small>
          </div>
        </section>

        {notice && (
          <div
            className={`notice ${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </div>
        )}
        {busy && <div className="loading" role="status">Syncing study…</div>}

        <div className="workspace">
          <fieldset className="editor-column" disabled={isLocked}>
            <section className="panel">
              <div className="section-number">01</div>
              <div className="panel-content">
                <h2>Study details</h2>
                <div className="field-grid">
                  <label className="field full">
                    Study title
                    <input
                      value={draft.title}
                      onChange={(event) =>
                        updateDraft({ title: event.target.value })
                      }
                    />
                  </label>
                  <label className="field full">
                    Research context
                    <textarea
                      rows={3}
                      value={draft.description ?? ""}
                      onChange={(event) =>
                        updateDraft({ description: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Target origin
                    <input
                      value={draft.target_origins[0] ?? ""}
                      onChange={(event) =>
                        updateDraft({ target_origins: [event.target.value] })
                      }
                    />
                  </label>
                  <label className="field">
                    Retention period
                    <select
                      value={draft.retention_days}
                      onChange={(event) =>
                        updateDraft({ retention_days: Number(event.target.value) })
                      }
                    >
                      <option value="7">7 days</option>
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                    </select>
                  </label>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="section-number">02</div>
              <div className="panel-content">
                <h2>Consent</h2>
                <p className="supporting">
                  Participants must accept this language before calibration starts.
                </p>
                <label className="field">
                  Consent version
                  <input
                    value={draft.consent_version}
                    onChange={(event) =>
                      updateDraft({ consent_version: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Consent text
                  <textarea
                    rows={4}
                    value={draft.consent_text}
                    onChange={(event) =>
                      updateDraft({ consent_text: event.target.value })
                    }
                  />
                </label>
              </div>
            </section>

            <section className="panel">
              <div className="section-number">03</div>
              <div className="panel-content">
                <h2>Collection mode</h2>
                <p className="supporting">Synthetic telemetry is the public default. Webcam gaze requires a separate participant consent and stays experimental.</p>
                <label className="capture-mode-toggle">
                  <input
                    type="checkbox"
                    checked={draft.collection_policy?.webcam_gaze_enabled ?? false}
                    onChange={(event) => updateDraft({ collection_policy: { ...(draft.collection_policy ?? { screenshots_enabled: false, sample_interval_ms: 100, webcam_gaze_enabled: false }), webcam_gaze_enabled: event.target.checked } })}
                  />
                  <span><strong>Enable experimental webcam gaze</strong><small>Participant frames stay in-browser; only consented coordinate samples are sent to this study API.</small></span>
                </label>
              </div>
            </section>

            <section className="panel">
              <div className="section-number">04</div>
              <div className="panel-content">
                <div className="section-heading">
                  <div>
                    <h2>Participant tasks</h2>
                    <p className="supporting">
                      Tasks become analysis boundaries for gaze samples.
                    </p>
                  </div>
                  <span>{draft.tasks.length} / 4</span>
                </div>
                <div className="task-list">
                  {draft.tasks.map((task, index) => (
                    <article className="task-card" key={index}>
                      <div className="task-index">Task {index + 1}</div>
                      <div className="task-fields">
                        <label className="field">
                          Title
                          <input
                            value={task.title}
                            onChange={(event) =>
                              updateTask(index, "title", event.target.value)
                            }
                          />
                        </label>
                        <label className="field">
                          Prompt
                          <textarea
                            rows={2}
                            value={task.prompt}
                            onChange={(event) =>
                              updateTask(index, "prompt", event.target.value)
                            }
                          />
                        </label>
                        <label className="field">
                          Start URL
                          <input
                            value={task.start_url}
                            onChange={(event) =>
                              updateTask(index, "start_url", event.target.value)
                            }
                          />
                        </label>
                      </div>
                      {draft.tasks.length > 1 && (
                        <button
                          className="text-button danger"
                          type="button"
                          onClick={() => removeTask(index)}
                        >
                          Remove
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {draft.tasks.length < 4 && (
                  <>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={addTask}
                      title={isLocked ? "Edit study to add tasks" : undefined}
                    >
                      + Add task
                    </button>
                    {isLocked && (
                      <p className="supporting locked-action-note">
                        This version is live. Select Edit study to change its tasks.
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
          </fieldset>

          <aside className="publish-panel">
            {isLocked ? (
              <>
                <p className="eyebrow">Published version {publishedVersion}</p>
                <h2>Participant study</h2>
                <p className="panel-description">
                  This version is live and cannot be changed.
                </p>
                {participantUrl ? (
                  <div className="participant-link published-link">
                    <span>Participant link</span>
                    <code>{participantUrl}</code>
                    <button
                      type="button"
                      className={`primary-button ${linkCopied ? "copied" : ""}`}
                      onClick={() => void copyParticipantLink()}
                      aria-live="polite"
                    >
                      {linkCopied ? "✓ Link copied" : "Copy participant link"}
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="secondary-button full"
                  onClick={() => {
                    setEditing(true);
                    setNotice({
                      kind: "success",
                      text: `You can now edit this study. Version ${publishedVersion} remains live until you publish changes.`,
                    });
                  }}
                >
                  Edit study
                </button>
                <button
                  type="button"
                  className="secondary-button full"
                  onClick={() => setResultsOpen(true)}
                >
                  View results
                </button>
                <p className="fine-print">
                  To stop new participants, close the study or revoke its link.
                </p>
              </>
            ) : (
              <>
                <p className="eyebrow">
                  {publishedVersion ? "New revision" : "Study status"}
                </p>
                <h2>Review &amp; publish</h2>
                <p className="panel-description">
                  Required fields are checked before a version is created.
                </p>
                <ul>
                  <li className={draft.title ? "complete" : ""}>Study details</li>
                  <li className={draft.consent_text ? "complete" : ""}>
                    Participant consent
                  </li>
                  <li className={draft.tasks.length > 0 ? "complete" : ""}>
                    1–4 ordered tasks
                  </li>
                  <li className={draft.target_origins.length > 0 ? "complete" : ""}>
                    Allowed website
                  </li>
                </ul>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || (publishedVersion !== null && !dirty)}
                  onClick={() => void publish()}
                >
                  {publishedVersion
                    ? "Publish changes"
                    : "Publish study"}
                </button>
                <button
                  type="button"
                  className="secondary-button full"
                  disabled={busy || Boolean(study && !dirty)}
                  onClick={() => void saveDraft()}
                >
                  Save draft
                </button>
                <p className="fine-print">
                  {publishedVersion
                    ? `Version ${publishedVersion} remains live until this revision is published.`
                    : "Published versions cannot be edited."}
                </p>
              </>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function ResultsDashboard({
  study,
  onBack,
}: {
  study: StudyDraftResponse;
  onBack: () => void;
}) {
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [sessions, setSessions] = useState<ParticipantSessionSummary[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [resultsByJob, setResultsByJob] = useState<Record<string, AnalysisResult>>({});
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(true);
  const [collectorArtifact, setCollectorArtifact] = useState<CollectorArtifact | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState(0);

  useEffect(() => {
    void loadJobs();
  }, [study.id]);

  async function loadJobs() {
    setBusy(true);
    try {
      const response = await api.listStudyAnalysisJobs(study.id);
      const sessionResponse = await api.listStudyParticipantSessions(study.id);
      setJobs(response.items);
      setSessions(sessionResponse.items);
      const latest = response.items[0];
      const completed = response.items.filter((job) => job.status === "succeeded");
      const loaded = await Promise.all(
        completed.map(async (job) => [job.id, await api.getAnalysisResult(job.id)] as const),
      );
      const nextResults = Object.fromEntries(loaded);
      setResultsByJob(nextResults);
      const selected = selectedJobId && nextResults[selectedJobId]
        ? selectedJobId
        : latest?.id ?? null;
      setSelectedJobId(selected);
      if (selected && nextResults[selected]) {
        setResult(nextResults[selected]);
      } else {
        setResult(null);
      }
    } catch (error) {
      const text = error instanceof ApiClientError ? error.message : "Could not load analysis jobs.";
      setNotice({ kind: "error", text });
    } finally {
      setBusy(false);
    }
  }

  async function runLatestJob(job: AnalysisJob) {
    setBusy(true);
    setNotice(null);
    try {
      const nextResult = await api.runAnalysisJob(job.id);
      setResult(nextResult);
      setSelectedJobId(job.id);
      setResultsByJob((current) => ({ ...current, [job.id]: nextResult }));
      setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: "succeeded" } : item));
    } catch (error) {
      const text = error instanceof ApiClientError ? error.message : "Analysis could not run.";
      setNotice({ kind: "error", text });
    } finally {
      setBusy(false);
    }
  }

  async function loadSyntheticResults() {
    setBusy(true);
    setNotice(null);
    try {
      const synthetic = await api.createSyntheticStudyResults(study.id);
      setResult(synthetic);
      await loadJobs();
      setNotice({
        kind: "success",
        text: "Synthetic demo results loaded. They are not collected participant data.",
      });
    } catch (error) {
      const text = error instanceof ApiClientError ? error.message : "Could not load synthetic results.";
      setNotice({ kind: "error", text });
      setBusy(false);
    }
  }

  function selectJob(jobId: string) {
    setSelectedJobId(jobId);
    setResult(resultsByJob[jobId] ?? null);
  }

  async function importCollectorArtifact(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseCollectorArtifact(JSON.parse(await file.text()));
      setCollectorArtifact(parsed);
      setSelectedSnapshot(0);
      setNotice({ kind: "success", text: "Collector session opened locally. It has not been uploaded to this study." });
    } catch (error) {
      setCollectorArtifact(null);
      const text = error instanceof Error ? error.message : "Could not read collector export.";
      setNotice({ kind: "error", text });
    }
  }

  function loadSyntheticCollectorReplay() {
    setCollectorArtifact(syntheticCollectorReplay);
    setSelectedSnapshot(0);
    setNotice({ kind: "success", text: "Synthetic collector replay loaded. It is generated demo data, not a participant session or camera capture." });
  }

  async function downloadExport(format: "json" | "csv") {
    const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? latest;
    if (!selectedJob) return;
    setBusy(true);
    try {
      const blob = await api.downloadAnalysisExport(selectedJob.id, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `webgaze-analysis-${selectedJob.id}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const text = error instanceof ApiClientError ? error.message : "Could not export results.";
      setNotice({ kind: "error", text });
    } finally {
      setBusy(false);
    }
  }

  const latest = jobs[0];
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? latest;
  const taskMetrics = (result?.task_metrics.tasks as Array<Record<string, unknown>> | undefined) ?? [];
  const completedResults = Object.values(resultsByJob);
  const aggregateEligibleResults = completedResults.filter(
    (completedResult) => completedResult.diagnostics.aggregate_eligible === true,
  );
  const aggregateSessionCount = completedResults.length;
  const aggregateMetrics = aggregateTaskMetrics(aggregateEligibleResults);
  const replaySamples = collectorArtifact ? gazeSamplesForSnapshot(collectorArtifact, selectedSnapshot) : [];
  const replayHeatmap = buildHeatmap(replaySamples);
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="WebGaze Research home"><span className="brand-mark">◉</span>WebGaze Research</a>
        <span className="environment">Independent demo</span>
      </header>
      <main>
        <button className="project-nav-button" type="button" onClick={onBack}>← Back to study</button>
        <section className="page-heading results-heading">
          <div>
            <p className="eyebrow">Research results</p>
            <h1>{study.title}</h1>
            <p>Task-level metrics are versioned outputs from submitted participant sessions.</p>
          </div>
          <span className={`status ${selectedJob?.status ?? "draft"}`}>{selectedJob ? selectedJob.status : "No sessions"}</span>
        </section>
        {notice && <div className={`notice ${notice.kind}`} role="alert">{notice.text}</div>}
        {busy && <div className="loading" role="status">Loading results…</div>}
        {!busy && !latest && <section className="empty-results"><h2>No submitted sessions yet</h2><p>Load a clearly labelled synthetic result set to explore the dashboard before camera-based collection is enabled.</p><button className="primary-button" type="button" onClick={() => void loadSyntheticResults()}>Load synthetic demo results</button></section>}
        {!busy && latest && <section className="results-grid">
          <aside className="publish-panel">
            <p className="eyebrow">Analysis session</p>
            <h2>{selectedJob?.algorithm_version}</h2>
            <p className="panel-description">Status: {selectedJob?.status}. Submitted results remain immutable after processing.</p>
            {jobs.length > 1 && <label className="job-selector">Choose session<select value={selectedJobId ?? ""} onChange={(event) => selectJob(event.target.value)}>{jobs.map((job, index) => <option key={job.id} value={job.id}>Session {jobs.length - index} · {job.status}</option>)}</select></label>}
            {selectedJob && selectedJob.status !== "succeeded" && <button className="primary-button" type="button" disabled={busy} onClick={() => void runLatestJob(selectedJob)}>Process selected analysis</button>}
            {sessions.length > 0 && <div className="session-health"><p className="eyebrow">Collection health</p>{sessions.slice(0, 3).map((session) => <div className="session-health-row" key={session.id}><strong>{session.participant_alias}</strong><span>{session.source === "synthetic-demo" ? "Synthetic demo" : `${session.completed_task_count} tasks · ${session.gaze_sample_count} samples`}</span><small>Calibration {session.calibration_quality ?? "not recorded"} · {session.analysis_status ?? session.lifecycle}</small></div>)}</div>}
          </aside>
          {result && <section className="results-panel">
            <div className="results-panel-header">
              <h2>Task metrics</h2>
              <div className="export-actions">
                <button className="secondary-button" type="button" disabled={busy} onClick={() => void downloadExport("csv")}>Download CSV</button>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => void downloadExport("json")}>Download JSON</button>
              </div>
            </div>
            {aggregateSessionCount > 1 && <p className="comparison-note">Viewing one selected session alongside {aggregateSessionCount - 1} additional completed session{aggregateSessionCount === 2 ? "" : "s"}. Export remains scoped to this session.</p>}
            {result.diagnostics.source === "synthetic-demo" && <div className="notice success">Synthetic demo data — generated for this public portfolio, not collected from a person or camera.</div>}
            <p className="supporting">{String(result.diagnostics.sample_count)} samples · calibration {String(result.quality.calibration_quality ?? "unavailable")}</p>
            <div className="metric-list">{taskMetrics.map((metric) => <article className="metric-card" key={String(metric.task_position)}><strong>Task {String(metric.task_position)} · {String(metric.task_title)}</strong><span>{String(metric.outcome)}</span><dl><div><dt>Samples</dt><dd>{String(metric.sample_count)}</dd></div><div><dt>Mean confidence</dt><dd>{metric.mean_confidence == null ? "—" : String(metric.mean_confidence)}</dd></div><div><dt>Gaze centroid</dt><dd>{metric.centroid && typeof metric.centroid === "object" ? `${String((metric.centroid as Record<string, unknown>).x_normalized)}, ${String((metric.centroid as Record<string, unknown>).y_normalized)}` : "—"}</dd></div></dl></article>)}</div>
            {aggregateMetrics.length > 0 && <section className="aggregate-summary" aria-label="Aggregate metrics">
              <div><p className="eyebrow">Comparable sessions</p><h3>Aggregate task metrics</h3></div>
              <p>{aggregateEligibleResults.length} consented participant session{aggregateEligibleResults.length === 1 ? "" : "s"}; synthetic sessions are excluded.</p>
              <div className="aggregate-list">{aggregateMetrics.map((metric) => <article key={metric.position}><strong>Task {metric.position} · {metric.title}</strong><span>{metric.sessionCount} sessions · {metric.sampleCount} samples · mean confidence {metric.meanConfidence?.toFixed(2) ?? "—"}</span></article>)}</div>
            </section>}
            {aggregateSessionCount > 0 && aggregateMetrics.length === 0 && <p className="aggregate-unavailable">Aggregate claims are unavailable: this demo currently contains synthetic or otherwise ineligible sessions only.</p>}
          </section>}
        </section>}
        {!busy && <section className="collector-review" aria-label="Collector session review">
          <div className="collector-review-heading">
            <div><p className="eyebrow">Local collector review</p><h2>Open an extension session</h2><p>Use this for a private researcher-side review of the exported artifact. The JSON stays in this browser and is not submitted to the API.</p></div>
            <div className="collector-actions"><button className="secondary-button" type="button" onClick={loadSyntheticCollectorReplay}>Load synthetic replay</button><label className="secondary-button collector-import">Open collector JSON<input type="file" accept="application/json,.json" onChange={(event) => void importCollectorArtifact(event.target.files?.[0])} /></label></div>
          </div>
          {collectorArtifact && <div className="collector-artifact-grid">
            <aside className="collector-summary"><p className="eyebrow">{collectorArtifact.sessionId === syntheticCollectorReplay.sessionId ? "Synthetic replay fixture" : "Session artifact"}</p><strong>{collectorArtifact.sessionId}</strong><span>{collectorArtifact.gazeSamples?.length ?? 0} estimated samples</span><span>{collectorArtifact.events.length} timeline events</span><span>{collectorArtifact.snapshots.length} consented snapshots</span><small>Raw camera video: never exported</small></aside>
            <section className="collector-timeline"><h3>Timeline</h3>{collectorArtifact.events.length === 0 && <p>No page events were captured.</p>}<ol>{collectorArtifact.events.slice(0, 12).map((event, index) => <li key={`${event.at}-${index}`}><strong>{event.type.replaceAll("-", " ")}</strong><span>{new Date(event.at).toLocaleTimeString()} · {event.url}</span></li>)}</ol></section>
            <section className="collector-snapshot"><div className="snapshot-title"><h3>Visible-tab gaze replay</h3><span>{replaySamples.length} samples in this segment</span></div>{collectorArtifact.snapshots.length === 0 ? <p>No snapshots were selected for this session.</p> : <><div className="snapshot-stage"><img src={collectorArtifact.snapshots[selectedSnapshot]?.dataUrl} alt="Consent-selected visible browser tab snapshot" />{replayHeatmap.map((cell) => <i className="replay-heat-cell" key={`${cell.x}-${cell.y}`} style={{ left: `${cell.x * 100}%`, top: `${cell.y * 100}%`, opacity: 0.18 + cell.intensity * 0.62, transform: `translate(-50%, -50%) scale(${0.72 + cell.intensity * 0.58})` }} title={`${cell.count} estimated samples`} />)}</div><div className="snapshot-controls"><button className="secondary-button" type="button" disabled={selectedSnapshot === 0} onClick={() => setSelectedSnapshot((current) => current - 1)}>Previous</button><span>{selectedSnapshot + 1} / {collectorArtifact.snapshots.length}</span><button className="secondary-button" type="button" disabled={selectedSnapshot === collectorArtifact.snapshots.length - 1} onClick={() => setSelectedSnapshot((current) => current + 1)}>Next</button></div></>}</section>
          </div>}
        </section>}
      </main>
    </div>
  );
}

function ProjectDashboard({
  projects,
  currentProjectId,
  onOpenProject,
  onCreateProject,
}: {
  projects: Project[];
  currentProjectId: string | null;
  onOpenProject: (project: Project) => void;
  onCreateProject: () => void;
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="WebGaze Research home">
          <span className="brand-mark" aria-hidden="true">◉</span>
          WebGaze Research
        </a>
        <span className="environment">Independent demo</span>
      </header>
      <main>
        <p className="eyebrow">Research workspace</p>
        <div className="dashboard-heading">
          <div>
            <h1>Projects</h1>
            <p>Organize studies, participant protocols, and analysis work in one place.</p>
          </div>
          <button className="primary-button dashboard-action" type="button" onClick={onCreateProject}>
            New project
          </button>
        </div>
        <section className="project-grid" aria-label="Research projects">
          {projects.map((item) => (
            <article className={`project-card ${item.id === currentProjectId ? "current" : ""}`} key={item.id}>
              <div className="project-card-topline">
                <span className="status active">Active</span>
                {item.id === currentProjectId && <span className="current-label">Currently open</span>}
              </div>
              <h2>{item.name}</h2>
              <p>{item.research_question ?? "No research question added yet."}</p>
              <button className="secondary-button full" type="button" onClick={() => onOpenProject(item)}>
                Open project
              </button>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}

function ProjectCreationPage({
  onCancel,
  onCreateProject,
}: {
  onCancel: () => void;
  onCreateProject: (name: string, researchQuestion?: string) => Promise<boolean>;
}) {
  const [projectName, setProjectName] = useState("");
  const [researchQuestion, setResearchQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    setSubmitting(true);
    await onCreateProject(name, researchQuestion);
    setSubmitting(false);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="WebGaze Research home">
          <span className="brand-mark" aria-hidden="true">◉</span>
          WebGaze Research
        </a>
        <span className="environment">Independent demo</span>
      </header>
      <main className="project-creation-main">
        <button className="project-nav-button" type="button" onClick={onCancel}>← Back to projects</button>
        <section className="creation-heading">
          <p className="eyebrow">New project</p>
          <h1>Create a research project</h1>
          <p>A project groups related study protocols, participant sessions, and analysis results.</p>
        </section>
        <form className="project-creation-card" onSubmit={(event) => void submitProject(event)}>
          <div>
            <h2>Project details</h2>
            <p>Start with the research context. You can create the first study next.</p>
          </div>
          <label className="field first-field">
            Project name
            <input
              autoFocus
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="e.g. Checkout accessibility"
              maxLength={160}
            />
          </label>
          <label className="field">
            Research question <span className="optional-label">Optional</span>
            <textarea
              value={researchQuestion}
              onChange={(event) => setResearchQuestion(event.target.value)}
              placeholder="e.g. Where do first-time shoppers hesitate before checkout?"
              maxLength={4000}
              rows={4}
            />
          </label>
          <div className="creation-actions">
            <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
            <button className="primary-button" type="submit" disabled={submitting || !projectName.trim()}>
              {submitting ? "Creating project…" : "Create project"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
