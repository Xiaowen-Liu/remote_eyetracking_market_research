import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";

import {
  api,
  ApiClientError,
  hasResearcherToken,
  saveResearcherToken,
  type AnalysisJob,
  type AnalysisResult,
  type ParticipantSessionSummary,
  type ProjectAccess,
  type ProjectMembership,
  type ProjectInvitation,
  type AuditEvent,
  type Project,
  type Researcher,
  type StudyDraft,
  type StudyDraftResponse,
} from "./api";
import { ParticipantRunner, participantTokenFromPath } from "./ParticipantRunner";
import { ExperimentalEyeTracking } from "./ExperimentalEyeTracking";
import { buildHeatmap, domProposalStates, gazeSamplesForSnapshot, parseCollectorArtifact, type CollectorArtifact } from "./collectorArtifact";
import { syntheticCollectorReplay } from "./demoCollectorArtifact";
import { AOI_MEANINGFUL_VISIT_MS, aggregateAoiMetrics, calculateAoiMetrics } from "./aoiMetrics";
import { detectScrollSegments, inferDocumentExtent, insertReplaySnapshot, projectReplaySample, snapshotDocumentStyle, type ReplayCoordinateMode } from "./replayCoordinates";
import { isEditableReplayTarget, replayKeyboardAction } from "./replayAccessibility";
import { windowReplaySamples } from "./replayWindow";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { clearStoredArtifacts, deleteStoredArtifact, listStoredArtifacts, storeArtifacts } from "./analysisStore";
import { collectorSessionHealth } from "./sessionHealth";

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
type ReplayAoi = { id: string; label: string; x: number; y: number; width: number; height: number; source: "manual" | "dom"; sessionIds?: string[]; allSessions?: boolean };
type SessionPreference = { name?: string; hidden?: boolean };

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

function formatReplayTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
  const [accessProject, setAccessProject] = useState<Project | null>(null);
  const [projectAccess, setProjectAccess] = useState<ProjectAccess | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [researcher, setResearcher] = useState<Researcher | null>(null);

  useEffect(() => {
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      if (hasResearcherToken()) {
        setResearcher(await api.getCurrentResearcher());
      }
      const projectList = await api.listProjects();
      const current =
        projectList.items[0] ?? (await api.createProject("Checkout UX research"));
      const available = projectList.items.length ? projectList.items : [current];
      setProjects(available);
      await selectProject(current);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        ["RESEARCHER_AUTH_REQUIRED", "INVALID_RESEARCHER_SESSION"].includes(error.code)
      ) {
        saveResearcherToken(null);
        setResearcher(null);
        setAuthRequired(true);
      } else {
        showError(error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function selectProject(nextProject: Project, isNewProject = false) {
    setBusy(true);
    setNotice(null);
    try {
      setProject(nextProject);
      setProjectAccess(null);
      setDashboardOpen(false);
      setResultsOpen(false);
      setStudy(null);
      setDraft(isNewProject ? { ...emptyDraft, title: "Untitled study", description: "" } : emptyDraft);
      setDirty(false);
      setEditing(true);
      setParticipantUrl(null);
      const [studies, access] = await Promise.all([
        api.listStudies(nextProject.id),
        api.getProjectAccess(nextProject.id),
      ]);
      setProjectAccess(access);
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
  const canEdit = projectAccess?.can_edit ?? false;
  const isLocked = !canEdit || (publishedVersion !== null && !editing);

  if (authRequired) {
    return (
      <ResearcherLoginPage
        onAuthenticated={async (sessionResearcher) => {
          setResearcher(sessionResearcher);
          setAuthRequired(false);
          setBusy(true);
          await bootstrap();
        }}
      />
    );
  }

  if (dashboardOpen) {
    if (accessProject) {
      return (
        <ProjectAccessPage
          project={accessProject}
          researcher={researcher}
          onBack={() => setAccessProject(null)}
        />
      );
    }
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
        onManageAccess={setAccessProject}
        researcher={researcher}
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
        {researcher ? (
          <div className="researcher-session">
            <span>{researcher.display_name}</span>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    await api.logoutResearcher();
                  } finally {
                    saveResearcherToken(null);
                    setResearcher(null);
                    setAuthRequired(true);
                  }
                })();
              }}
            >
              Sign out
            </button>
          </div>
        ) : (
          <span className="environment">Independent demo</span>
        )}
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
                        {canEdit
                          ? "This version is live. Select Edit study to change its tasks."
                          : "Viewer access is read-only. An owner can change your project role."}
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
                {canEdit && (
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
                )}
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
                {!canEdit ? (
                  <>
                    <p className="eyebrow">Viewer access</p>
                    <h2>Read-only study</h2>
                    <p className="panel-description">
                      You can review this protocol and its results, but only an owner or editor can publish changes.
                    </p>
                    {study && (
                      <button type="button" className="secondary-button full" onClick={() => setResultsOpen(true)}>
                        View results
                      </button>
                    )}
                  </>
                ) : <>
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
                </>}
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
  const [collectorArtifacts, setCollectorArtifacts] = useState<CollectorArtifact[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState(0);
  const [workspaceView, setWorkspaceView] = useState<"analysis" | "sessions">("analysis");
  const [analysisView, setAnalysisView] = useState<"replay" | "metrics" | "dom">("replay");
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayTimeMs, setReplayTimeMs] = useState(0);
  const [replayAnnouncement, setReplayAnnouncement] = useState("Replay paused at 0 seconds.");
  const [heatMode, setHeatMode] = useState<"selected" | "buildup" | "whole">("buildup");
  const [orderMode, setOrderMode] = useState<"off" | "scanpath" | "aoi">("off");
  const [drawingAoi, setDrawingAoi] = useState(false);
  const [aoiDraft, setAoiDraft] = useState<Omit<ReplayAoi, "id" | "label" | "source"> | null>(null);
  const [aoiLabel, setAoiLabel] = useState("New AOI");
  const [replayAois, setReplayAois] = useState<ReplayAoi[]>([]);
  const [selectedAoiId, setSelectedAoiId] = useState<string | null>(null);
  const [aoiDetailView, setAoiDetailView] = useState<"summary" | "sessions" | "visits" | "samples">("summary");
  const [proposalStateIndex, setProposalStateIndex] = useState(0);
  const [selectedProposalIndex, setSelectedProposalIndex] = useState(0);
  const [heatCuts, setHeatCuts] = useState<number[]>([]);
  const [selectedHeatSegment, setSelectedHeatSegment] = useState(0);
  const [heatNames, setHeatNames] = useState<Record<number, string>>({});
  const [exportingHeatmap, setExportingHeatmap] = useState(false);
  const [exportingVideoProgress, setExportingVideoProgress] = useState<number | null>(null);
  const [coordinateMode, setCoordinateMode] = useState<ReplayCoordinateMode>("viewport");
  const [scrollScope, setScrollScope] = useState("auto");
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [sessionPreferences, setSessionPreferences] = useState<Record<string, SessionPreference>>({});
  const [showHiddenSessions, setShowHiddenSessions] = useState(false);
  const aoiDragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void loadJobs();
  }, [study.id]);

  useEffect(() => {
    try { setSessionPreferences(JSON.parse(localStorage.getItem(`webgaze.sessions.${study.id}`) ?? "{}")); }
    catch { setSessionPreferences({}); }
  }, [study.id]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`webgaze.aois.${study.id}`) ?? "[]");
      setReplayAois(Array.isArray(stored) ? stored : []);
    } catch {
      setReplayAois([]);
    }
  }, [study.id]);

  useEffect(() => {
    let active = true;
    void listStoredArtifacts(study.id).then((stored) => {
      if (!active || !stored.length) return;
      setCollectorArtifacts(stored);
      setCollectorArtifact((current) => current ?? stored[0]);
      if (!collectorArtifact) restoreHeatPreferences(stored[0]);
    }).catch(() => {
      if (active) setNotice({ kind: "error", text: "The local extension-session archive could not be opened. Imports still work for this tab." });
    });
    return () => { active = false; };
  }, [study.id]);

  useEffect(() => {
    if (!replayPlaying || !collectorArtifact) return;
    const started = Date.now();
    const initial = replayTimeMs;
    const duration = Math.max(0, Date.parse(collectorArtifact.endedAt ?? collectorArtifact.startedAt) - Date.parse(collectorArtifact.startedAt));
    const timer = window.setInterval(() => {
      const next = Math.min(duration, initial + (Date.now() - started) * replaySpeed);
      setReplayTimeMs(next);
      if (next >= duration) setReplayPlaying(false);
    }, 50);
    return () => window.clearInterval(timer);
  }, [replayPlaying, replaySpeed, collectorArtifact]);

  useEffect(() => {
    if (!collectorArtifact?.snapshots.length) return;
    const absoluteTime = Date.parse(collectorArtifact.startedAt) + replayTimeMs;
    let nextIndex = 0;
    collectorArtifact.snapshots.forEach((snapshot, index) => {
      if (Date.parse(snapshot.at) <= absoluteTime) nextIndex = index;
    });
    setSelectedSnapshot(nextIndex);
  }, [collectorArtifact, replayTimeMs]);

  useEffect(() => {
    if (workspaceView !== "analysis" || analysisView !== "replay" || !collectorArtifact) return;
    const duration = Math.max(0, Date.parse(collectorArtifact.endedAt ?? collectorArtifact.startedAt) - Date.parse(collectorArtifact.startedAt));
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableReplayTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const action = replayKeyboardAction(event.key);
      if (!action) return;
      event.preventDefault();
      if (action.type === "toggle") {
        setReplayPlaying((current) => !current);
        return;
      }
      setReplayPlaying(false);
      const next = action.type === "seek"
        ? Math.min(duration, Math.max(0, replayTimeMs + action.deltaMs))
        : action.position === "start" ? 0 : duration;
      setReplayTimeMs(next);
      setReplayAnnouncement(`Replay paused at ${formatReplayTime(next)}.`);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [analysisView, collectorArtifact, replayTimeMs, workspaceView]);

  useEffect(() => {
    if (!collectorArtifact) return;
    setReplayAnnouncement(`${replayPlaying ? "Replay playing from" : "Replay paused at"} ${formatReplayTime(replayTimeMs)}.`);
    // Announce state transitions, not each 50 ms playback tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectorArtifact, replayPlaying]);

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

  function restoreHeatPreferences(artifact: CollectorArtifact) {
    try {
      const stored = JSON.parse(localStorage.getItem(`webgaze.heat.${artifact.sessionId}`) ?? "{}");
      setHeatCuts(Array.isArray(stored.cuts) ? stored.cuts.filter(Number.isFinite).sort((a: number, b: number) => a - b) : []);
      setHeatNames(stored.names && typeof stored.names === "object" ? stored.names : {});
    } catch { setHeatCuts([]); setHeatNames({}); }
    setSelectedHeatSegment(0);
  }

  async function importCollectorArtifacts(files: FileList | null) {
    if (!files?.length) return;
    try {
      const imported: CollectorArtifact[] = [];
      for (const file of Array.from(files)) {
        if (file.name.toLowerCase().endsWith(".zip")) {
          const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
          for (const [name, bytes] of Object.entries(entries)) if (name.toLowerCase().endsWith(".json")) imported.push(parseCollectorArtifact(JSON.parse(strFromU8(bytes))));
        } else imported.push(parseCollectorArtifact(JSON.parse(await file.text())));
      }
      const merged = new Map(collectorArtifacts.map((artifact) => [artifact.sessionId, artifact]));
      imported.forEach((artifact) => merged.set(artifact.sessionId, artifact));
      const next = [...merged.values()].sort((a, b) => Date.parse(b.endedAt ?? b.startedAt) - Date.parse(a.endedAt ?? a.startedAt));
      const parsed = imported.at(-1)!;
      setCollectorArtifacts(next);
      setCollectorArtifact(parsed);
      setSelectedSnapshot(0);
      setReplayTimeMs(0);
      setReplayPlaying(false);
      restoreHeatPreferences(parsed);
      await storeArtifacts(study.id, imported);
      setNotice({ kind: "success", text: `${imported.length} collector session${imported.length === 1 ? "" : "s"} imported locally and merged by session ID.` });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not read collector export.";
      setNotice({ kind: "error", text });
    }
  }

  function loadSyntheticCollectorReplay() {
    setCollectorArtifact(syntheticCollectorReplay);
    setCollectorArtifacts((current) => [...new Map([...current, syntheticCollectorReplay].map((artifact) => [artifact.sessionId, artifact])).values()]);
    setSelectedSnapshot(0);
    setReplayTimeMs(0);
    setReplayPlaying(false);
    restoreHeatPreferences(syntheticCollectorReplay);
    setNotice({ kind: "success", text: "Synthetic collector replay loaded. It is generated demo data, not a participant session or camera capture." });
  }

  async function insertScreenshot(file: File | undefined) {
    if (!file || !collectorArtifact) return;
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose an image file to insert into replay.");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to read this screenshot."));
        reader.onerror = () => reject(new Error("Unable to read this screenshot."));
        reader.readAsDataURL(file);
      });
      const next = insertReplaySnapshot(collectorArtifact, dataUrl, replayTimeMs);
      setCollectorArtifact(next);
      setCollectorArtifacts((current) => current.map((artifact) => artifact.sessionId === next.sessionId ? next : artifact));
      setSelectedSnapshot(next.snapshots.findIndex((snapshot) => snapshot.reason === "researcher-inserted" && Date.parse(snapshot.at) === Date.parse(next.startedAt) + replayTimeMs));
      await storeArtifacts(study.id, [next]);
      setNotice({ kind: "success", text: `Screenshot inserted at ${formatReplayTime(replayTimeMs)}. Export the analysis bundle to preserve it.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to insert this screenshot." });
    }
  }

  function pointerPosition(event: ReactPointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  function beginAoiDraw(event: ReactPointerEvent<HTMLElement>) {
    if (!drawingAoi) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = pointerPosition(event);
    aoiDragStart.current = start;
    setAoiDraft({ ...start, width: 0, height: 0 });
  }

  function updateAoiDraw(event: ReactPointerEvent<HTMLElement>) {
    if (!drawingAoi || !aoiDragStart.current) return;
    const current = pointerPosition(event);
    const start = aoiDragStart.current;
    setAoiDraft({ x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y) });
  }

  function finishAoiDraw(event: ReactPointerEvent<HTMLElement>) {
    if (!aoiDragStart.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    aoiDragStart.current = null;
  }

  function saveAoi() {
    if (!aoiDraft || aoiDraft.width < .01 || aoiDraft.height < .01) return;
    const next = [...replayAois, { ...aoiDraft, id: crypto.randomUUID(), label: aoiLabel.trim() || "New AOI", source: "manual" as const }];
    setReplayAois(next);
    localStorage.setItem(`webgaze.aois.${study.id}`, JSON.stringify(next));
    setAoiDraft(null);
    setAoiLabel("New AOI");
    setDrawingAoi(false);
    setNotice({ kind: "success", text: "AOI saved to this study and is ready for historical session analysis." });
  }

  function persistAois(next: ReplayAoi[]) {
    setReplayAois(next);
    localStorage.setItem(`webgaze.aois.${study.id}`, JSON.stringify(next));
  }

  function addProposal(label: string, proposal: { x: number; y: number; width: number; height: number }) {
    if (replayAois.some((aoi) => aoi.label.toLocaleLowerCase() === label.toLocaleLowerCase())) return;
    persistAois([...replayAois, { ...proposal, id: crypto.randomUUID(), label, source: "dom", sessionIds: collectorArtifact ? [collectorArtifact.sessionId] : [] }]);
    setNotice({ kind: "success", text: `${label} was added to this study and is now available in AOI Metrics.` });
  }

  function saveHeatPreferences(cuts: number[], names = heatNames) {
    setHeatCuts(cuts);
    setHeatNames(names);
    if (collectorArtifact) localStorage.setItem(`webgaze.heat.${collectorArtifact.sessionId}`, JSON.stringify({ cuts, names }));
  }

  function saveSessionPreference(sessionId: string, preference: SessionPreference) {
    const next = { ...sessionPreferences, [sessionId]: { ...sessionPreferences[sessionId], ...preference } };
    setSessionPreferences(next);
    localStorage.setItem(`webgaze.sessions.${study.id}`, JSON.stringify(next));
  }

  function updateAoi(id: string, updates: Partial<ReplayAoi>) {
    persistAois(replayAois.map((aoi) => aoi.id === id ? { ...aoi, ...updates } : aoi));
  }

  function removeAoi(id: string) {
    persistAois(replayAois.filter((aoi) => aoi.id !== id));
    if (selectedAoiId === id) setSelectedAoiId(null);
    setNotice({ kind: "success", text: "AOI removed. Raw session data was not changed." });
  }

  function downloadCollectorArtifact() {
    if (!collectorArtifact) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(collectorArtifact, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `webgaze-session-${collectorArtifact.sessionId}.json`; link.click(); URL.revokeObjectURL(url);
  }

  function downloadArtifact(artifact: CollectorArtifact) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `webgaze-session-${artifact.sessionId}.json`; link.click(); URL.revokeObjectURL(url);
  }

  async function removeLocalArtifact(artifact: CollectorArtifact) {
    if (!window.confirm(`Delete session "${sessionPreferences[artifact.sessionId]?.name || artifact.sessionId}"? This cannot be undone.`)) return;
    await deleteStoredArtifact(study.id, artifact.sessionId);
    const next = collectorArtifacts.filter((candidate) => candidate.sessionId !== artifact.sessionId);
    setCollectorArtifacts(next);
    if (collectorArtifact?.sessionId === artifact.sessionId) {
      setCollectorArtifact(next.find((candidate) => !sessionPreferences[candidate.sessionId]?.hidden) ?? null);
      setReplayTimeMs(0);
    }
    setNotice({ kind: "success", text: "Extension session permanently deleted from this browser." });
  }

  async function removeAllLocalArtifacts() {
    if (!collectorArtifacts.length || !window.confirm(`Delete all ${collectorArtifacts.length} extension sessions in "${study.title}"? This cannot be undone.`)) return;
    await clearStoredArtifacts(study.id);
    setCollectorArtifacts([]);
    setCollectorArtifact(null);
    setNotice({ kind: "success", text: "All locally archived extension sessions were permanently deleted." });
  }

  function exportAnalysisBundle() {
    const sessions = collectorArtifacts.length ? collectorArtifacts : collectorArtifact ? [collectorArtifact] : [];
    const files: Record<string, Uint8Array> = {};
    sessions.forEach((artifact) => { files[`sessions/${artifact.sessionId}.json`] = strToU8(JSON.stringify(artifact, null, 2)); });
    files["analysis-workspace.json"] = strToU8(JSON.stringify({ study: { id: study.id, title: study.title }, aois: replayAois, heatPreferences: collectorArtifact ? { sessionId: collectorArtifact.sessionId, cuts: heatCuts, names: heatNames } : null, exportedAt: new Date().toISOString() }, null, 2));
    const url = URL.createObjectURL(new Blob([zipSync(files)], { type: "application/zip" }));
    const link = document.createElement("a"); link.href = url; link.download = `webgaze-analysis-${study.id}.zip`; link.click(); URL.revokeObjectURL(url);
  }

  function exportCollectorSessions() {
    if (!collectorArtifacts.length) return;
    const files: Record<string, Uint8Array> = {};
    collectorArtifacts.forEach((artifact) => {
      files[`sessions/${artifact.sessionId}.json`] = strToU8(JSON.stringify(artifact, null, 2));
    });
    files["manifest.json"] = strToU8(JSON.stringify({
      schemaVersion: "1.0",
      study: { id: study.id, title: study.title },
      sessionCount: collectorArtifacts.length,
      exportedAt: new Date().toISOString(),
      contents: "Raw privacy-preserving extension session artifacts; no analysis preferences or camera frames.",
    }, null, 2));
    const url = URL.createObjectURL(new Blob([zipSync(files)], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `webgaze-sessions-${study.id}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice({ kind: "success", text: `${collectorArtifacts.length} raw extension session${collectorArtifacts.length === 1 ? "" : "s"} exported without camera frames.` });
  }

  async function exportHeatmap() {
    const snapshot = collectorArtifact?.snapshots[selectedSnapshot];
    if (!snapshot) return;
    setExportingHeatmap(true);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Unable to prepare heatmap image.")); image.src = snapshot.dataUrl; });
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas heatmap export is unavailable here.");
      context.drawImage(image, 0, 0);
      for (const cell of replayHeatmap) {
        const cx = cell.x * canvas.width, cy = cell.y * canvas.height, radius = Math.max(18, Math.min(canvas.width, canvas.height) * .055 * (.7 + cell.intensity));
        const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `rgba(220,55,25,${.35 + cell.intensity * .5})`); gradient.addColorStop(.45, "rgba(245,155,35,.42)"); gradient.addColorStop(1, "rgba(255,220,70,0)");
        context.fillStyle = gradient; context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
      const link = document.createElement("a"); link.download = `webgaze-heatmap-${collectorArtifact!.sessionId}.png`; link.href = canvas.toDataURL("image/png"); link.click();
      setNotice({ kind: "success", text: "Heatmap exported for the selected replay range." });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to export heatmap." }); }
    finally { setExportingHeatmap(false); }
  }

  async function exportReplayVideo() {
    if (!collectorArtifact?.snapshots.length || exportingVideoProgress !== null) return;
    setReplayPlaying(false);
    setExportingVideoProgress(0);
    try {
      if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
        throw new Error("Video export is not supported in this browser context.");
      }
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error("Canvas video export is unavailable here.");
      const images = await Promise.all(collectorArtifact.snapshots.map((snapshot) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("Unable to prepare replay export.")); image.src = snapshot.dataUrl;
      })));
      const first = images[0];
      const scale = Math.min(1, 1280 / Math.max(1, first.naturalWidth));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(320, Math.round(first.naturalWidth * scale)); canvas.height = Math.max(180, Math.round(first.naturalHeight * scale));
      const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas video export is unavailable here.");
      const framesPerSecond = 15;
      const outputSeconds = Math.min(30, Math.max(2, replayDurationMs / 8000));
      const frameCount = Math.max(1, Math.round(outputSeconds * framesPerSecond));
      const stream = canvas.captureStream(framesPerSecond);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("Replay video export failed.")); });
      recorder.start(250);
      for (let frame = 0; frame <= frameCount; frame += 1) {
        const replayAt = replayDurationMs * frame / frameCount;
        const absoluteAt = Date.parse(collectorArtifact.startedAt) + replayAt;
        let snapshotIndex = 0;
        collectorArtifact.snapshots.forEach((snapshot, index) => { if (Date.parse(snapshot.at) <= absoluteAt) snapshotIndex = index; });
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(images[snapshotIndex], 0, 0, canvas.width, canvas.height);
        const samples = (collectorArtifact.gazeSamples ?? []).filter((sample) => !sample.at || Date.parse(sample.at) <= absoluteAt);
        for (const cell of buildHeatmap(samples)) {
          const x = cell.x * canvas.width, y = cell.y * canvas.height, radius = Math.max(16, Math.min(canvas.width, canvas.height) * .045 * (.7 + cell.intensity));
          const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, `rgba(220,55,25,${.35 + cell.intensity * .5})`); gradient.addColorStop(.45, "rgba(245,155,35,.42)"); gradient.addColorStop(1, "rgba(255,220,70,0)");
          context.fillStyle = gradient; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
        context.fillStyle = "rgba(18,30,23,.82)"; context.fillRect(16, canvas.height - 48, 150, 32);
        context.fillStyle = "white"; context.font = "600 16px system-ui"; context.fillText(formatReplayTime(replayAt), 28, canvas.height - 27);
        setExportingVideoProgress(Math.round(frame / frameCount * 100));
        await new Promise((resolve) => window.setTimeout(resolve, 1000 / framesPerSecond));
      }
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      const url = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
      const link = document.createElement("a"); link.href = url; link.download = `webgaze-replay-${collectorArtifact.sessionId}.${extension}`; link.click(); URL.revokeObjectURL(url);
      setNotice({ kind: "success", text: `Replay video exported as ${extension.toUpperCase()} with time-compressed heatmap buildup.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to export replay video." });
    } finally {
      setExportingVideoProgress(null);
    }
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
  const replayDurationMs = collectorArtifact ? Math.max(0, Date.parse(collectorArtifact.endedAt ?? collectorArtifact.startedAt) - Date.parse(collectorArtifact.startedAt)) : 0;
  const heatBoundaries = [0, ...heatCuts.filter((cut) => cut > 0 && cut < replayDurationMs), replayDurationMs];
  const heatSegments = heatBoundaries.slice(0, -1).map((start, index) => ({ start, end: heatBoundaries[index + 1], name: heatNames[index] || `Heatmap ${index + 1}` }));
  const activeHeatSegment = heatSegments[Math.min(selectedHeatSegment, Math.max(0, heatSegments.length - 1))] ?? { start: 0, end: replayDurationMs, name: "Heatmap 1" };
  const scrollSegments = detectScrollSegments(collectorArtifact?.gazeSamples ?? []);
  const replaySamples = collectorArtifact ? gazeSamplesForSnapshot(collectorArtifact, selectedSnapshot) : [];
  const scopedReplaySamples = scrollScope === "all"
    ? (collectorArtifact?.gazeSamples ?? [])
    : scrollScope === "auto"
      ? replaySamples
      : scrollSegments.find((segment) => segment.id === scrollScope)?.samples ?? [];
  const replayCutoff = collectorArtifact ? Date.parse(collectorArtifact.startedAt) + replayTimeMs : 0;
  const visibleReplaySamples = heatMode === "whole" ? scopedReplaySamples : heatMode === "selected" && collectorArtifact ? scopedReplaySamples.filter((sample) => { const time = sample.at ? Date.parse(sample.at) - Date.parse(collectorArtifact.startedAt) : 0; return time >= activeHeatSegment.start && time <= activeHeatSegment.end; }) : scopedReplaySamples.filter((sample) => !sample.at || Date.parse(sample.at) <= replayCutoff);
  const documentExtent = collectorArtifact ? inferDocumentExtent(collectorArtifact) : { width: 1, height: 1 };
  const activeSnapshot = collectorArtifact?.snapshots[selectedSnapshot];
  const displayReplaySamples = windowReplaySamples(visibleReplaySamples).map((sample) => projectReplaySample(sample, coordinateMode, documentExtent, activeSnapshot));
  const replayHeatmap = buildHeatmap(displayReplaySamples);
  const scanpathNodes = displayReplaySamples.filter((_, index) => index % Math.max(1, Math.floor(displayReplaySamples.length / 12)) === 0).slice(-12);
  const aoiOrder = replayAois.filter((aoi) => visibleReplaySamples.some((sample) => sample.x >= aoi.x && sample.x <= aoi.x + aoi.width && sample.y >= aoi.y && sample.y <= aoi.y + aoi.height));
  const displayAois = replayAois.map((aoi) => {
    if (coordinateMode === "viewport" || !activeSnapshot) return aoi;
    const viewport = activeSnapshot.viewport ?? documentExtent;
    const scroll = activeSnapshot.scroll ?? { x: 0, y: 0 };
    return {
      ...aoi,
      x: (scroll.x + aoi.x * viewport.width) / documentExtent.width,
      y: (scroll.y + aoi.y * viewport.height) / documentExtent.height,
      width: aoi.width * viewport.width / documentExtent.width,
      height: aoi.height * viewport.height / documentExtent.height,
    };
  });
  const aoiMetrics = collectorArtifact ? calculateAoiMetrics(replayAois, collectorArtifact.gazeSamples ?? [], collectorArtifact.startedAt) : [];
  const selectedAoiMetric = aoiMetrics.find((metric) => metric.aoi.id === selectedAoiId) ?? null;
  const visibleCollectorArtifacts = collectorArtifacts.filter((artifact) => !sessionPreferences[artifact.sessionId]?.hidden);
  const hiddenCollectorArtifactCount = collectorArtifacts.length - visibleCollectorArtifacts.length;
  const archivedCollectorArtifacts = collectorArtifacts.filter((artifact) => showHiddenSessions || !sessionPreferences[artifact.sessionId]?.hidden);
  const aggregateAoiResults = aggregateAoiMetrics(
    replayAois,
    visibleCollectorArtifacts.map((artifact) => ({ sessionId: artifact.sessionId, startedAt: artifact.startedAt, endedAt: artifact.endedAt, samples: artifact.gazeSamples ?? [] })),
    (aoi, sessionId) => {
      const configured = replayAois.find((candidate) => candidate.id === aoi.id);
      return configured?.source === "manual" || configured?.allSessions === true || !configured?.sessionIds?.length || configured.sessionIds.includes(sessionId);
    },
  );
  const selectedAggregateAoi = aggregateAoiResults.find((metric) => metric.aoi.id === selectedAoiId) ?? null;
  const proposalStates = collectorArtifact ? domProposalStates(collectorArtifact) : [];
  const proposalState = proposalStates[proposalStateIndex] ?? null;
  const selectedProposal = proposalState?.proposals[selectedProposalIndex] ?? null;
  const newProposals = proposalState?.proposals
    .filter((proposal) => !replayAois.some((aoi) => aoi.label.toLocaleLowerCase() === proposal.label.toLocaleLowerCase()))
    .map((proposal) => ({ ...proposal, sessionIds: collectorArtifact ? [collectorArtifact.sessionId] : [] })) ?? [];
  const proposalSnapshotIndex = collectorArtifact && proposalState ? collectorArtifact.snapshots.reduce((best, snapshot, index) => Math.abs(Date.parse(snapshot.at) - Date.parse(proposalState.at)) < Math.abs(Date.parse(collectorArtifact.snapshots[best]?.at ?? collectorArtifact.startedAt) - Date.parse(proposalState.at)) ? index : best, 0) : 0;
  const visibleSessionCount = sessions.filter((session) => !sessionPreferences[session.id]?.hidden).length;
  const hiddenSessionCount = sessions.length - visibleSessionCount;
  const archivedSessions = sessions.filter((session) => showHiddenSessions || !sessionPreferences[session.id]?.hidden);
  const replayHealth = collectorArtifact ? collectorSessionHealth(collectorArtifact) : null;
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="WebGaze Research home"><span className="brand-mark">EA</span>Eyetracking Analysis</a>
        <div className="study-identity"><span>Study</span><strong>{study.title}</strong></div>
        <details className="workspace-actions">
          <summary aria-label="Workspace actions">•••</summary>
          <div className="workspace-actions-menu">
            <strong>Study data</strong>
            <label className="workspace-action-import">Import Sessions<input type="file" multiple accept="application/json,.json,.zip,application/zip" onChange={(event) => { void importCollectorArtifacts(event.target.files); event.target.value = ""; }} /></label>
            <button type="button" disabled={!collectorArtifacts.length} onClick={exportCollectorSessions}>Export Sessions</button>
            <button type="button" disabled={!collectorArtifacts.length} onClick={exportAnalysisBundle}>Export Analysis Bundle</button>
            <small>Imports merge by session ID. Raw exports never include camera frames.</small>
          </div>
        </details>
      </header>
      <nav className="workspace-tabs" aria-label="Dashboard sections">
        <button type="button" onClick={onBack}>Setup</button>
        <button type="button" className={workspaceView === "analysis" ? "active" : ""} onClick={() => setWorkspaceView("analysis")}>Analysis</button>
        <button type="button" className={workspaceView === "sessions" ? "active" : ""} onClick={() => setWorkspaceView("sessions")}>Sessions</button>
      </nav>
      <main>
        <section className="page-heading results-heading">
          <div>
            <p className="eyebrow">{workspaceView === "analysis" ? "Analysis workspace" : "Session archive"}</p>
            <h1>{workspaceView === "analysis" ? "Research results" : "Saved sessions"}</h1>
            <p>{workspaceView === "analysis" ? "Replay a participant journey, inspect task metrics, and review captured page context." : "Archive is separate from analysis so selection and management do not compete with visualization."}</p>
          </div>
          <span className={`status ${selectedJob?.status ?? "draft"}`}>{selectedJob ? selectedJob.status : "No sessions"}</span>
        </section>
        {notice && <div className={`notice ${notice.kind}`} role="alert">{notice.text}</div>}
        {busy && <div className="loading" role="status">Loading results…</div>}
        {!busy && workspaceView === "sessions" && <section className="session-archive-panel">
          <div className="session-archive-header"><div><p className="eyebrow">Session archive</p><h2>Saved sessions</h2></div><div className="archive-actions"><span className="context-chip">{visibleSessionCount} visible</span><span className="context-chip">{hiddenSessionCount} hidden</span><button className="secondary-button" type="button" disabled={!hiddenSessionCount} onClick={() => setShowHiddenSessions((current) => !current)}>{showHiddenSessions ? "Hide Hidden Sessions" : "Show Hidden Sessions"}</button>{collectorArtifact && <button className="secondary-button" type="button" onClick={downloadCollectorArtifact}>Download opened JSON</button>}</div></div>
          {sessions.length === 0 ? <p className="archive-empty">No sessions are stored for this study yet.</p> : archivedSessions.length === 0 ? <p className="archive-empty">No visible sessions. Hidden sessions stay out of analysis until you show and unhide them.</p> : <div className="session-table-wrap"><table className="session-table"><thead><tr><th>Session</th><th>Tasks</th><th>Samples</th><th>Quality</th><th>Status</th><th>Actions</th></tr></thead><tbody>{archivedSessions.map((session) => { const preference = sessionPreferences[session.id] ?? {}; return <tr className={preference.hidden ? "hidden-session" : ""} key={session.id}><td><strong>{preference.name || session.participant_alias}</strong><small>{session.id}</small></td><td>{session.completed_task_count}</td><td>{session.gaze_sample_count.toLocaleString()}</td><td>{session.calibration_quality ?? "Not recorded"}</td><td>{preference.hidden ? "Hidden" : session.lifecycle}</td><td><div className="row-actions">{!preference.hidden && <button type="button" className="text-button" onClick={() => { setWorkspaceView("analysis"); setAnalysisView("metrics"); }}>Open</button>}<button type="button" className="text-button" onClick={() => { const name = window.prompt("Rename session. Leave blank to restore the default page title.", preference.name || session.participant_alias); if (name !== null) saveSessionPreference(session.id, { name: name.trim() || undefined }); }}>Rename</button><button type="button" className="text-button" onClick={() => { saveSessionPreference(session.id, { hidden: !preference.hidden }); if (!preference.hidden) setShowHiddenSessions(true); }}>{preference.hidden ? "Unhide" : "Hide"}</button>{collectorArtifact?.sessionId === session.id && <button type="button" className="text-button" onClick={downloadCollectorArtifact}>Download</button>}</div></td></tr>; })}</tbody></table></div>}
        </section>}
        {!busy && workspaceView === "sessions" && <section className="session-archive-panel local-archive-panel"><div className="session-archive-header"><div><p className="eyebrow">Local extension archive</p><h2>Replay artifacts</h2><p>Imported extension sessions persist in this browser through IndexedDB and remain separate from immutable server analysis.</p></div><div className="archive-actions"><span className="context-chip">{visibleCollectorArtifacts.length} visible</span><span className="context-chip">{hiddenCollectorArtifactCount} hidden</span><button className="secondary-button danger" type="button" disabled={!collectorArtifacts.length} onClick={() => void removeAllLocalArtifacts()}>Delete All Sessions</button></div></div>{collectorArtifacts.length === 0 ? <p className="archive-empty">No extension sessions are stored in this browser yet. Import JSON or ZIP files from Replay.</p> : archivedCollectorArtifacts.length === 0 ? <p className="archive-empty">No visible extension sessions. Show hidden sessions above to manage them.</p> : <div className="session-table-wrap"><table className="session-table"><thead><tr><th>Session</th><th>Completed</th><th>Samples</th><th>Screens</th><th>Status</th><th>Actions</th></tr></thead><tbody>{archivedCollectorArtifacts.map((artifact) => { const preference = sessionPreferences[artifact.sessionId] ?? {}; return <tr className={preference.hidden ? "hidden-session" : ""} key={artifact.sessionId}><td><strong>{preference.name || artifact.sessionId.slice(0, 12)}</strong><small>{artifact.sessionId}</small></td><td>{artifact.endedAt ? new Date(artifact.endedAt).toLocaleString() : "In progress"}</td><td>{(artifact.gazeSamples ?? []).length.toLocaleString()}</td><td>{artifact.snapshots.length}</td><td>{preference.hidden ? "Hidden" : "Visible"}</td><td><div className="row-actions">{!preference.hidden && <button type="button" className="text-button" onClick={() => { setCollectorArtifact(artifact); setReplayTimeMs(0); restoreHeatPreferences(artifact); setWorkspaceView("analysis"); setAnalysisView("replay"); }}>Open</button>}<button type="button" className="text-button" onClick={() => { const name = window.prompt("Rename session. Leave blank to restore the default page title.", preference.name || artifact.sessionId); if (name !== null) saveSessionPreference(artifact.sessionId, { name: name.trim() || undefined }); }}>Rename</button><button type="button" className="text-button" onClick={() => { saveSessionPreference(artifact.sessionId, { hidden: !preference.hidden }); if (!preference.hidden) { setShowHiddenSessions(true); if (collectorArtifact?.sessionId === artifact.sessionId) setCollectorArtifact(null); } }}>{preference.hidden ? "Unhide" : "Hide"}</button><button type="button" className="text-button" onClick={() => downloadArtifact(artifact)}>Download</button><button type="button" className="text-button danger" onClick={() => void removeLocalArtifact(artifact)}>Delete</button></div></td></tr>; })}</tbody></table></div>}</section>}
        {!busy && workspaceView === "analysis" && <>
        <section className="session-context" aria-label="Session context"><span>Session</span><select value={selectedJobId ?? ""} onChange={(event) => selectJob(event.target.value)} disabled={!jobs.length}><option value="">{jobs.length ? "Select a session" : "No visible sessions"}</option>{jobs.map((job, index) => <option key={job.id} value={job.id}>Session {jobs.length - index} · {job.status}</option>)}</select>{result && <><span className="context-chip">{String(result.diagnostics.sample_count)} samples</span><span className="context-chip">Calibration {String(result.quality.calibration_quality ?? "unavailable")}</span><span className="context-chip">{selectedJob?.status}</span></>}</section>
        <nav className="analysis-tabs" aria-label="Analysis views" role="tablist"><button type="button" role="tab" aria-selected={analysisView === "replay"} className={analysisView === "replay" ? "active" : ""} onClick={() => setAnalysisView("replay")}>Replay</button><button type="button" role="tab" aria-selected={analysisView === "metrics"} className={analysisView === "metrics" ? "active" : ""} onClick={() => setAnalysisView("metrics")}>AOI Metrics</button><button type="button" role="tab" aria-selected={analysisView === "dom"} className={analysisView === "dom" ? "active" : ""} onClick={() => setAnalysisView("dom")}>DOM Proposals</button></nav>
        {analysisView === "metrics" && replayAois.length > 0 && <details className="aoi-management"><summary>Areas of Interest · {replayAois.length}</summary><p>Rename or fine-tune saved regions. Coordinate changes immediately recompute historical metrics.</p><div className="aoi-management-list">{replayAois.map((aoi, index) => <article key={aoi.id}><div className="aoi-management-title"><strong>AOI {index + 1}</strong><button className="text-button danger" type="button" onClick={() => removeAoi(aoi.id)}>Remove</button></div><label>Label<input value={aoi.label} onChange={(event) => updateAoi(aoi.id, { label: event.target.value })} /></label><span>Source: {aoi.source === "dom" ? "added from DOM proposal" : "manual AOI rectangle"}</span>{aoi.source === "dom" && <div className="aoi-applicability"><button className={`secondary-button ${aoi.allSessions ? "active-tool" : ""}`} type="button" onClick={() => updateAoi(aoi.id, { allSessions: !aoi.allSessions })}>{aoi.allSessions ? "Enabled for all sessions" : "Enable for all sessions"}</button><small>{aoi.allSessions ? "This AOI is forced applicable across the whole study." : "Use this only when you are sure the page and layout are the same across sessions."}</small></div>}<details><summary>Advanced coordinates</summary><div className="coordinate-grid">{(["x", "y", "width", "height"] as const).map((field) => <label key={field}>{field}<input type="number" min="0" max="1" step="0.01" value={aoi[field]} onChange={(event) => updateAoi(aoi.id, { [field]: Number(event.target.value) || 0 })} /></label>)}</div></details></article>)}</div></details>}
        {analysisView === "metrics" && (!collectorArtifact || replayAois.length === 0) && <section className="empty-results dashboard-empty"><h2>AOI Performance Table</h2><p>{!collectorArtifact ? "Open a collector JSON in Replay to compute AOI metrics from its raw gaze samples." : "No AOIs yet. Draw one on the Replay canvas and return here; historical samples will be recomputed immediately."}</p></section>}
        {analysisView === "metrics" && collectorArtifact && replayAois.length > 0 && <section className="aoi-metrics-panel"><div className="aoi-metrics-heading"><div><p className="eyebrow">AOI metrics</p><h2>AOI Performance Table</h2><p>Metrics are recomputed from saved raw gaze samples across all visible imported sessions. Meaningful visits require {AOI_MEANINGFUL_VISIT_MS}ms.</p></div><span className="context-chip">{visibleCollectorArtifacts.length} visible session{visibleCollectorArtifacts.length === 1 ? "" : "s"}</span></div><div className="session-table-wrap"><table className="session-table aoi-table"><thead><tr><th>Area of interest</th><th>Exposure</th><th>Avg dwell</th><th>Avg proportion</th><th>Median TTFF</th><th>Median meaningful latency</th><th>Revisit rate</th></tr></thead><tbody>{aggregateAoiResults.map((metric) => <tr key={metric.aoi.id}><td><button className="aoi-name-button" type="button" onClick={() => { setSelectedAoiId(metric.aoi.id); setAoiDetailView("summary"); }}>{metric.aoi.label}</button></td><td>{Math.round(metric.exposureRate * 100)}%</td><td>{formatReplayTime(metric.averageDwellMs)}</td><td>{Math.round(metric.averageDwellProportion * 100)}%</td><td>{metric.medianTtffMs == null ? "—" : formatReplayTime(metric.medianTtffMs)}</td><td>{metric.medianFirstMeaningfulLatencyMs == null ? "—" : formatReplayTime(metric.medianFirstMeaningfulLatencyMs)}</td><td>{Math.round(metric.revisitRate * 100)}%</td></tr>)}</tbody></table></div>{selectedAoiMetric && selectedAggregateAoi && <section className="aoi-drilldown"><div><p className="eyebrow">AOI drill-down</p><h3>{selectedAoiMetric.aoi.label}</h3><p>Move from aggregated metrics into per-session visits and underlying sample records.</p></div><nav className="drilldown-tabs">{(["summary", "sessions", "visits", "samples"] as const).map((view) => <button type="button" className={aoiDetailView === view ? "active" : ""} onClick={() => setAoiDetailView(view)} key={view}>{view}</button>)}</nav>{aoiDetailView === "summary" && <div className="aoi-summary-grid"><article><strong>Applicable sessions</strong><b>{selectedAggregateAoi.applicableSessions}</b><span>included in this AOI</span></article><article><strong>Sessions noticed</strong><b>{selectedAggregateAoi.noticedSessions}</b><span>had dwell above zero</span></article><article><strong>Total visits</strong><b>{selectedAggregateAoi.sessionMetrics.reduce((sum, metric) => sum + metric.visits.length, 0)}</b><span>initial visits plus revisits</span></article><article><strong>Current replay samples</strong><b>{selectedAoiMetric.sampleCount}</b><span>inside this rectangle</span></article></div>}{aoiDetailView === "sessions" && <div className="session-table-wrap"><table className="session-table"><thead><tr><th>Session</th><th>Noticed</th><th>Dwell</th><th>TTFF</th><th>Revisits</th><th></th></tr></thead><tbody>{selectedAggregateAoi.sessionMetrics.map((metric) => <tr key={metric.sessionId}><td>{sessionPreferences[metric.sessionId]?.name || metric.sessionId.slice(0, 8)}</td><td>{metric.sampleCount ? "Yes" : "No"}</td><td>{formatReplayTime(metric.dwellMs)}</td><td>{metric.ttffMs == null ? "—" : formatReplayTime(metric.ttffMs)}</td><td>{metric.revisitCount}</td><td><button type="button" className="text-button" onClick={() => { const artifact = collectorArtifacts.find((candidate) => candidate.sessionId === metric.sessionId); if (artifact) { setCollectorArtifact(artifact); setReplayTimeMs(0); restoreHeatPreferences(artifact); setAnalysisView("replay"); } }}>Open in Replay</button></td></tr>)}</tbody></table></div>}{aoiDetailView === "visits" && <div className="session-table-wrap"><table className="session-table"><thead><tr><th>Start</th><th>Duration</th><th>Samples</th><th>Meaningful</th><th></th></tr></thead><tbody>{selectedAoiMetric.visits.map((visit, index) => <tr key={visit.startedAt}><td>Visit {index + 1} · {new Date(visit.startedAt).toLocaleTimeString()}</td><td>{formatReplayTime(visit.durationMs)}</td><td>{visit.samples.length}</td><td>{visit.meaningful ? "Yes" : "No"}</td><td><button type="button" className="text-button" onClick={() => { setReplayTimeMs(Math.max(0, Date.parse(visit.startedAt) - Date.parse(collectorArtifact.startedAt))); setAnalysisView("replay"); }}>Open at Visit</button></td></tr>)}</tbody></table>{selectedAoiMetric.visits.length === 0 && <p>This AOI was not visited in the selected session.</p>}</div>}{aoiDetailView === "samples" && <><p className="drilldown-copy">{selectedAoiMetric.samples.length} matching rows. {selectedAoiMetric.samples.length > 250 && "Showing the first 250 matching raw rows to keep the dashboard readable."}</p><div className="session-table-wrap raw-sample-table"><table className="session-table"><thead><tr><th>Time</th><th>Viewport x/y</th><th>Document x/y</th><th>Scroll x/y</th></tr></thead><tbody>{selectedAoiMetric.samples.slice(0, 250).map((sample, index) => { const projected = projectReplaySample(sample, "document", documentExtent, activeSnapshot); return <tr key={`${sample.at}-${index}`}><td>{sample.at ? new Date(sample.at).toLocaleTimeString() : "—"}</td><td>{sample.x.toFixed(3)}, {sample.y.toFixed(3)}</td><td>{projected.x.toFixed(3)}, {projected.y.toFixed(3)}</td><td>{sample.scroll?.x ?? 0}, {sample.scroll?.y ?? 0}</td></tr>; })}</tbody></table></div></>}</section>}</section>}
        {analysisView === "metrics" && !latest && <section className="empty-results"><h2>No server analysis yet</h2><p>Local AOI metrics remain available above. Submit a participant session to produce an immutable server analysis.</p><button className="primary-button" type="button" onClick={() => void loadSyntheticResults()}>Load synthetic demo results</button></section>}
        {analysisView === "metrics" && latest && <section className="results-grid">
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
        {analysisView === "replay" && <section className="collector-review" aria-label="Collector session review">
          <p className="replay-shortcut-help">Keyboard: Space or K play/pause · J/← back 5 seconds · L/→ forward 5 seconds · Home/End jump to boundary.</p>
          <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{replayAnnouncement}</p>
          <div className="collector-review-heading">
            <div><p className="eyebrow">Local collector review</p><h2>Open an extension session</h2><p>Use this for a private researcher-side review of the exported artifact. The JSON stays in this browser and is not submitted to the API.</p></div>
            <div className="collector-actions">{collectorArtifacts.length > 1 && <select aria-label="Replay session" value={collectorArtifact?.sessionId ?? ""} onChange={(event) => { const artifact = collectorArtifacts.find((item) => item.sessionId === event.target.value); if (artifact) { setCollectorArtifact(artifact); setReplayTimeMs(0); setSelectedSnapshot(0); restoreHeatPreferences(artifact); } }}>{collectorArtifacts.map((artifact) => <option value={artifact.sessionId} key={artifact.sessionId}>{artifact.sessionId.slice(0, 8)} · {(artifact.gazeSamples ?? []).length} samples</option>)}</select>}<button className="secondary-button" type="button" onClick={loadSyntheticCollectorReplay}>Load synthetic replay</button></div>
          </div>
          {collectorArtifact && <div className="collector-artifact-grid">
            <aside className="collector-summary"><p className="eyebrow">{collectorArtifact.sessionId === syntheticCollectorReplay.sessionId ? "Synthetic replay fixture" : "Session artifact"}</p><strong>{collectorArtifact.sessionId}</strong><span>{collectorArtifact.gazeSamples?.length ?? 0} estimated samples</span><span>{collectorArtifact.events.length} timeline events</span><span>{collectorArtifact.snapshots.length} consented snapshots</span>{replayHealth && <><span className={`health-grade ${replayHealth.grade}`} title={replayHealth.explanation}>Tracking health: {replayHealth.grade}</span><span>{formatReplayTime(replayHealth.durationMs)} · {replayHealth.sampleRateHz.toFixed(1)} Hz</span><span>Calibration {collectorArtifact.calibration?.quality_grade ?? "not recorded"}</span></>}<small>Raw camera video: never exported</small></aside>
            <section className="collector-timeline"><h3>Timeline</h3>{collectorArtifact.events.length === 0 && <p>No page events were captured.</p>}<ol>{collectorArtifact.events.slice(0, 12).map((event, index) => <li key={`${event.at}-${index}`}><strong>{event.type.replaceAll("-", " ")}</strong><span>{new Date(event.at).toLocaleTimeString()} · {event.url}</span></li>)}</ol></section>
            <section className="collector-snapshot"><div className="snapshot-title"><h3>Replay canvas</h3><span>{visibleReplaySamples.length} visible samples · {coordinateMode}</span></div>{collectorArtifact.snapshots.length === 0 ? <p>No snapshots were selected for this session.</p> : <><div className={`snapshot-stage ${drawingAoi ? "drawing-aoi" : ""} ${coordinateMode === "document" ? "document-mode" : ""}`} style={coordinateMode === "document" ? { aspectRatio: `${documentExtent.width} / ${documentExtent.height}` } : undefined} onPointerDown={beginAoiDraw} onPointerMove={updateAoiDraw} onPointerUp={finishAoiDraw}><img className={coordinateMode === "document" ? "document-snapshot" : ""} style={coordinateMode === "document" && activeSnapshot ? snapshotDocumentStyle(activeSnapshot, documentExtent) : undefined} src={activeSnapshot?.dataUrl} alt="Consent-selected visible browser tab snapshot" draggable="false" />{replayHeatmap.map((cell) => <i className="replay-heat-cell" key={`${cell.x}-${cell.y}`} style={{ left: `${cell.x * 100}%`, top: `${cell.y * 100}%`, opacity: 0.18 + cell.intensity * 0.62, transform: `translate(-50%, -50%) scale(${0.72 + cell.intensity * 0.58})` }} title={`${cell.count} estimated samples`} />)}{displayAois.map((aoi) => <i className="saved-aoi" key={aoi.id} style={{ left: `${aoi.x * 100}%`, top: `${aoi.y * 100}%`, width: `${aoi.width * 100}%`, height: `${aoi.height * 100}%` }}><span>{aoi.label}</span></i>)}{aoiDraft && <i className="aoi-draft" style={{ left: `${aoiDraft.x * 100}%`, top: `${aoiDraft.y * 100}%`, width: `${aoiDraft.width * 100}%`, height: `${aoiDraft.height * 100}%` }} />}{orderMode === "scanpath" && scanpathNodes.map((sample, index) => <i className="scanpath-node" key={`${sample.at}-${index}`} style={{ left: `${sample.x * 100}%`, top: `${sample.y * 100}%` }}>{index + 1}</i>)}{orderMode === "aoi" && aoiOrder.map((aoi, index) => { const display = displayAois.find((candidate) => candidate.id === aoi.id) ?? aoi; return <i className="aoi-order-node" key={aoi.id} style={{ left: `${(display.x + display.width / 2) * 100}%`, top: `${(display.y + display.height / 2) * 100}%` }}>{index + 1}</i>; })}{!drawingAoi && <button className="replay-stage-control" type="button" aria-label={replayPlaying ? "Pause replay" : "Play replay"} onClick={() => setReplayPlaying((current) => !current)}>{replayPlaying ? "Ⅱ" : "▶"}</button>}</div><div className="replay-analysis-tools"><button className="secondary-button" type="button" onClick={() => setOrderMode((current) => current === "off" ? "scanpath" : current === "scanpath" ? "aoi" : "off")}>{orderMode === "off" ? "Show scanpath order" : orderMode === "scanpath" ? "Scanpath order on" : "AOI order on"}</button><button className={`secondary-button ${drawingAoi ? "active-tool" : ""}`} type="button" disabled={coordinateMode === "document"} onClick={() => { setDrawingAoi((current) => !current); setAoiDraft(null); }}>{drawingAoi ? "Drawing AOI" : "Draw AOI"}</button><label className="secondary-button collector-import">Insert screenshot<input type="file" accept="image/*" onChange={(event) => { void insertScreenshot(event.target.files?.[0]); event.target.value = ""; }} /></label><span>{coordinateMode === "document" ? "Document mode aligns viewport captures and gaze using recorded scroll context." : drawingAoi ? "Drag directly on the replay screenshot to add a viewport AOI." : orderMode === "scanpath" ? "Numbered nodes show raw gaze samples by screen position, without AOIs." : orderMode === "aoi" ? "Numbered nodes show AOIs reached in this replay." : "Inspect gaze buildup or define an area of interest."}</span></div>{aoiDraft && <div className="aoi-editor"><label>Label<input value={aoiLabel} onChange={(event) => setAoiLabel(event.target.value)} /></label><strong>{Math.round(aoiDraft.width * 100)}% × {Math.round(aoiDraft.height * 100)}%</strong><button className="primary-button" type="button" disabled={aoiDraft.width < .01 || aoiDraft.height < .01} onClick={saveAoi}>Save AOI</button><button className="secondary-button" type="button" onClick={() => { setAoiDraft(null); setDrawingAoi(false); }}>Cancel</button></div>}<div className="replay-toolbar"><button className="secondary-button" type="button" onClick={() => setReplayPlaying((current) => !current)}>{replayPlaying ? "Pause" : "Play"}</button><strong>{formatReplayTime(replayTimeMs)} / {formatReplayTime(replayDurationMs)}</strong><label>Speed<select value={replaySpeed} onChange={(event) => setReplaySpeed(Number(event.target.value))}>{[.5, 1, 1.5, 2, 4, 8].map((speed) => <option key={speed} value={speed}>{speed}x</option>)}</select></label><label>Heat<select value={heatMode} onChange={(event) => setHeatMode(event.target.value as "selected" | "buildup" | "whole")}><option value="selected">Final selected heatmap</option><option value="buildup">Replay buildup</option><option value="whole">Whole session</option></select></label></div><input className="replay-scrubber" aria-label="Replay timeline" type="range" min="0" max={Math.max(1, replayDurationMs)} step="50" value={replayTimeMs} onChange={(event) => { setReplayPlaying(false); setReplayTimeMs(Number(event.target.value)); }} /><section className="replay-view-settings"><button type="button" className="view-settings-toggle" aria-expanded={viewSettingsOpen} onClick={() => setViewSettingsOpen((current) => !current)}>View settings <span>{viewSettingsOpen ? "−" : "+"}</span></button>{viewSettingsOpen && <div className="view-settings-grid"><label>Session<select value={collectorArtifact.sessionId} onChange={(event) => { const artifact = collectorArtifacts.find((item) => item.sessionId === event.target.value); if (artifact) { setCollectorArtifact(artifact); setReplayTimeMs(0); setScrollScope("auto"); restoreHeatPreferences(artifact); } }}>{collectorArtifacts.map((artifact) => <option key={artifact.sessionId} value={artifact.sessionId}>{artifact.sessionId.slice(0, 8)}</option>)}</select></label><label>Coords<select value={coordinateMode} onChange={(event) => { setCoordinateMode(event.target.value as ReplayCoordinateMode); setDrawingAoi(false); setAoiDraft(null); }}><option value="viewport">Viewport</option><option value="document">Document</option></select></label><label>Scroll<select value={scrollScope} onChange={(event) => setScrollScope(event.target.value)}><option value="auto">Auto · current screen</option><option value="all">All scroll positions</option>{scrollSegments.map((segment) => <option key={segment.id} value={segment.id}>{segment.label} · {segment.samples.length} samples</option>)}</select></label></div>}</section><section className="heatmap-editor"><div><p className="eyebrow">Heatmap</p><h4>{heatSegments.length} heatmap{heatSegments.length === 1 ? "" : "s"} · {formatReplayTime(activeHeatSegment.start)} to {formatReplayTime(activeHeatSegment.end)}</h4><p>The session starts as one heatmap. Add a cut at the playhead only where you want a focused view.</p></div><div className="heat-segments">{heatSegments.map((segment, index) => <button type="button" className={selectedHeatSegment === index ? "selected" : ""} style={{ flexGrow: Math.max(1, segment.end - segment.start) }} onClick={() => setSelectedHeatSegment(index)} onDoubleClick={() => { const name = window.prompt("Name this heatmap", segment.name); if (name?.trim()) saveHeatPreferences(heatCuts, { ...heatNames, [index]: name.trim() }); }} key={index}><strong>{segment.name}</strong><span>{formatReplayTime(segment.start)}–{formatReplayTime(segment.end)}</span></button>)}</div><div className="heatmap-actions"><button className="secondary-button" type="button" disabled={replayTimeMs <= 0 || replayTimeMs >= replayDurationMs || heatCuts.some((cut) => Math.abs(cut - replayTimeMs) < 500)} onClick={() => { const next = [...heatCuts, replayTimeMs].sort((a, b) => a - b); saveHeatPreferences(next); setSelectedHeatSegment(next.findIndex((cut) => cut === replayTimeMs) + 1); }}>Add cut at playhead</button><button className="secondary-button" type="button" disabled={!heatCuts.length} onClick={() => { saveHeatPreferences([]); setSelectedHeatSegment(0); }}>Merge into whole session</button><button className="secondary-button" type="button" disabled={!heatCuts.length && !Object.keys(heatNames).length} onClick={() => { saveHeatPreferences([], {}); setSelectedHeatSegment(0); }}>Reset cuts</button><button className="primary-button" type="button" disabled={exportingHeatmap || !visibleReplaySamples.length} onClick={() => void exportHeatmap()}>{exportingHeatmap ? "Exporting…" : "Export heatmap"}</button></div></section><div className="snapshot-controls"><button className="secondary-button" type="button" disabled={selectedSnapshot === 0} onClick={() => { const next = Math.max(0, selectedSnapshot - 1); setReplayTimeMs(Math.max(0, Date.parse(collectorArtifact.snapshots[next].at) - Date.parse(collectorArtifact.startedAt))); }}>Previous screen</button><span>Screen {selectedSnapshot + 1} / {collectorArtifact.snapshots.length}</span><button className="secondary-button" type="button" disabled={selectedSnapshot === collectorArtifact.snapshots.length - 1} onClick={() => { const next = Math.min(collectorArtifact.snapshots.length - 1, selectedSnapshot + 1); setReplayTimeMs(Math.max(0, Date.parse(collectorArtifact.snapshots[next].at) - Date.parse(collectorArtifact.startedAt))); }}>Next screen</button></div></>}</section>
            <section className="replay-video-export"><div><strong>Portable replay</strong><span>Render a time-compressed video with screen changes and gaze buildup.</span></div><button className="primary-button" type="button" disabled={exportingVideoProgress !== null || !collectorArtifact.snapshots.length} onClick={() => void exportReplayVideo()}>{exportingVideoProgress === null ? "Export video" : `Exporting ${exportingVideoProgress}%`}</button></section>
          </div>}
        </section>}
        {analysisView === "dom" && proposalStates.length === 0 && <section className="empty-results dashboard-empty"><p className="eyebrow">Automatic AOI review</p><h2>DOM proposals</h2><p>{collectorArtifact ? "This replay session does not contain live DOM proposal AOIs. Replay screenshots are not used to reconstruct missing DOM proposals." : "Select or import a replay session to review live DOM proposal AOIs."}</p></section>}
        {analysisView === "dom" && proposalState && collectorArtifact && <section className="dom-proposals-panel"><div className="dom-proposals-header"><div><p className="eyebrow">Automatic AOI review</p><h2>DOM Proposals</h2><p>Review regions captured from the live DOM at recording time.</p></div><button className="primary-button" type="button" disabled={!newProposals.length} onClick={() => { const additions = newProposals.map((proposal) => ({ ...proposal, id: crypto.randomUUID(), source: "dom" as const })); persistAois([...replayAois, ...additions]); setNotice({ kind: "success", text: `${additions.length} DOM proposals were added to this study.` }); }}>{newProposals.length ? `Add ${newProposals.length} New` : "All Added"}</button></div><div className="proposal-toolbar"><label>Screen state<select value={proposalStateIndex} onChange={(event) => { setProposalStateIndex(Number(event.target.value)); setSelectedProposalIndex(0); }}>{proposalStates.map((state, index) => <option value={index} key={`${state.at}-${index}`}>{new Date(state.at).toLocaleTimeString()} · {state.trigger} · {state.proposals.length}</option>)}</select></label><span className="context-chip">{proposalState.proposals.length} on screen</span><span className="context-chip">{newProposals.length} new</span><span className="context-chip">{proposalState.proposals.length - newProposals.length} added</span></div><div className="proposal-grid"><section><div className="snapshot-title"><h3>Screen Preview</h3><span>{new Date(proposalState.at).toLocaleTimeString()} · {proposalState.trigger}</span></div>{collectorArtifact.snapshots[proposalSnapshotIndex] ? <div className="proposal-preview"><img src={collectorArtifact.snapshots[proposalSnapshotIndex].dataUrl} alt="Recorded page state" />{proposalState.proposals.map((proposal, index) => <button type="button" key={`${proposal.label}-${index}`} className={selectedProposalIndex === index ? "selected" : ""} aria-label={`Select ${proposal.label}`} onClick={() => setSelectedProposalIndex(index)} style={{ left: `${Math.max(0, proposal.x) * 100}%`, top: `${Math.max(0, proposal.y) * 100}%`, width: `${Math.min(1, proposal.width) * 100}%`, height: `${Math.min(1, proposal.height) * 100}%` }}>{selectedProposalIndex === index ? "Selected" : index + 1}</button>)}</div> : <p>This screen state has DOM proposals, but no matching screenshot preview was saved.</p>}</section><aside><div className="proposal-inspector"><p className="eyebrow">Selected candidate</p><h3>{selectedProposal?.label ?? "No proposal selected"}</h3>{selectedProposal && <><span>{selectedProposal.tag}{selectedProposal.role ? ` · ${selectedProposal.role}` : ""}</span><p>{Math.round(selectedProposal.width * 100)}% × {Math.round(selectedProposal.height * 100)}% of viewport</p><button className="primary-button" type="button" disabled={replayAois.some((aoi) => aoi.label.toLocaleLowerCase() === selectedProposal.label.toLocaleLowerCase())} onClick={() => addProposal(selectedProposal.label, selectedProposal)}>{replayAois.some((aoi) => aoi.label.toLocaleLowerCase() === selectedProposal.label.toLocaleLowerCase()) ? "Added" : "Add to Study"}</button></>}</div><ol className="proposal-list">{proposalState.proposals.map((proposal, index) => { const added = replayAois.some((aoi) => aoi.label.toLocaleLowerCase() === proposal.label.toLocaleLowerCase()); return <li className={selectedProposalIndex === index ? "selected" : ""} key={`${proposal.label}-${index}`}><button type="button" onClick={() => setSelectedProposalIndex(index)}><b>{index + 1}</b><span><strong>{proposal.label}</strong><small>{proposal.tag} · {Math.round(proposal.width * proposal.height * 100)}% viewport</small></span><em>{added ? "Added" : "Review"}</em></button></li>; })}</ol></aside></div></section>}
        </>}
      </main>
    </div>
  );
}

function ProjectDashboard({
  projects,
  currentProjectId,
  onOpenProject,
  onCreateProject,
  onManageAccess,
  researcher,
}: {
  projects: Project[];
  currentProjectId: string | null;
  onOpenProject: (project: Project) => void;
  onCreateProject: () => void;
  onManageAccess: (project: Project) => void;
  researcher: Researcher | null;
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="WebGaze Research home">
          <span className="brand-mark" aria-hidden="true">◉</span>
          WebGaze Research
        </a>
        <span className="environment">{researcher?.display_name ?? "Independent demo"}</span>
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
              <div className="project-card-actions">
                <button className="secondary-button full" type="button" onClick={() => onOpenProject(item)}>
                  Open project
                </button>
                {researcher && <button className="text-button" type="button" onClick={() => onManageAccess(item)}>
                  Team &amp; access
                </button>}
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}

const auditLabels: Record<string, string> = {
  "project.created": "Project created",
  "project.updated": "Project details updated",
  "project.deleted": "Project deleted",
  "project.member_added": "Member added",
  "project.member_role_updated": "Member role changed",
  "project.member_removed": "Member removed",
  "project.invitation_created": "Invitation created",
  "project.invitation_cancelled": "Invitation cancelled",
  "project.invitation_accepted": "Invitation accepted",
  "project.ownership_transferred": "Project ownership transferred",
};

function ProjectAccessPage({
  project,
  researcher,
  onBack,
}: {
  project: Project;
  researcher: Researcher | null;
  onBack: () => void;
}) {
  const [access, setAccess] = useState<ProjectAccess | null>(null);
  const [members, setMembers] = useState<ProjectMembership[]>([]);
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<ProjectMembership | null>(null);
  const [transferConfirmation, setTransferConfirmation] = useState("");
  const [previousOwnerRole, setPreviousOwnerRole] = useState<"editor" | "viewer">("editor");

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const currentAccess = await api.getProjectAccess(project.id);
      setAccess(currentAccess);
      if (currentAccess.can_manage_members) {
        const [memberList, invitationList, auditList] = await Promise.all([
          api.listProjectMembers(project.id),
          api.listProjectInvitations(project.id),
          api.listProjectAuditEvents(project.id),
        ]);
        setMembers(memberList.items);
        setInvitations(invitationList.items);
        setEvents(auditList.items);
      }
    } catch (loadError) {
      setError(loadError instanceof ApiClientError ? loadError.message : "Project access could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [project.id]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.inviteProjectMember(project.id, email.trim(), role);
      setSuccess(result.outcome === "member_added" ? "Member added." : `Invitation pending for ${email.trim().toLowerCase()}.`);
      setEmail("");
      await load();
    } catch (addError) {
      setError(addError instanceof ApiClientError ? addError.message : "The member could not be added.");
      setBusy(false);
    }
  }

  async function cancelInvitation(invitation: ProjectInvitation) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.cancelProjectInvitation(project.id, invitation.id);
      setSuccess(`Invitation cancelled for ${invitation.email}.`);
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof ApiClientError ? cancelError.message : "The invitation could not be cancelled.");
      setBusy(false);
    }
  }

  async function changeRole(membership: ProjectMembership, nextRole: "editor" | "viewer") {
    setBusy(true);
    setError(null);
    try {
      await api.updateProjectMember(project.id, membership.id, nextRole);
      await load();
    } catch (updateError) {
      setError(updateError instanceof ApiClientError ? updateError.message : "The role could not be changed.");
      setBusy(false);
    }
  }

  async function removeMember(membership: ProjectMembership) {
    if (!window.confirm(`Remove ${membership.researcher.display_name} from this project?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeProjectMember(project.id, membership.id);
      await load();
    } catch (removeError) {
      setError(removeError instanceof ApiClientError ? removeError.message : "The member could not be removed.");
      setBusy(false);
    }
  }

  async function transferOwnership() {
    if (!transferTarget || transferConfirmation !== project.name) return;
    setBusy(true);
    setError(null);
    try {
      await api.transferProjectOwnership(project.id, transferTarget.id, previousOwnerRole);
      setTransferTarget(null);
      setTransferConfirmation("");
      await load();
    } catch (transferError) {
      setError(transferError instanceof ApiClientError ? transferError.message : "Ownership could not be transferred.");
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={onBack}>
          <span className="brand-mark" aria-hidden="true">◉</span> WebGaze Research
        </button>
        <span className="environment">{researcher?.display_name ?? "Independent demo"}</span>
      </header>
      <main>
        <button className="text-button access-back" type="button" onClick={onBack}>← Back to projects</button>
        <div className="page-heading access-heading">
          <div><p className="eyebrow">Team &amp; access</p><h1>{project.name}</h1><p>Control who can configure studies and inspect consented research results.</p></div>
          {access && <span className={`role-badge ${access.role}`}>Your role · {access.role}</span>}
        </div>
        {error && <div className="notice error" role="alert">{error}</div>}
        {success && <div className="notice success" role="status">{success}</div>}
        {busy && !access ? <div className="loading">Loading project access…</div> : null}
        {access && !access.can_manage_members && (
          <section className="access-summary panel-card">
            <p className="eyebrow">Project permissions</p>
            <h2>{access.role === "editor" ? "You can build and publish studies" : "You have read-only access"}</h2>
            <p>{access.role === "editor" ? "Editors can change study protocols and run analysis. Only owners can manage the team or delete the project." : "Viewers can inspect protocols, participant sessions, and results. They cannot change or publish a study."}</p>
          </section>
        )}
        {access?.can_manage_members && (
          <div className="access-layout">
            <section className="panel-card members-panel">
              <div><p className="eyebrow">Project members</p><h2>{members.length} {members.length === 1 ? "person" : "people"}</h2></div>
              <form className="member-invite" onSubmit={(event) => void addMember(event)}>
                <label>Email<input type="email" required placeholder="researcher@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                <label>Role<select value={role} onChange={(event) => setRole(event.target.value as "editor" | "viewer")}><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label>
                <button className="primary-button" type="submit" disabled={busy}>Invite member</button>
                <small>Existing researchers join immediately. New researchers appear as pending until they sign in.</small>
              </form>
              <ul className="member-list">
                {members.map((membership) => (
                  <li key={membership.id}>
                    <span className="member-avatar" aria-hidden="true">{membership.researcher.display_name.slice(0, 1).toUpperCase()}</span>
                    <span><strong>{membership.researcher.display_name}</strong><small>{membership.researcher.email}</small></span>
                    {membership.role === "owner" ? <span className="role-badge owner">Owner</span> : <select aria-label={`Role for ${membership.researcher.display_name}`} disabled={busy} value={membership.role} onChange={(event) => void changeRole(membership, event.target.value as "editor" | "viewer")}><option value="viewer">Viewer</option><option value="editor">Editor</option></select>}
                    {membership.role !== "owner" && <div className="member-actions"><button className="text-button" type="button" disabled={busy} onClick={() => { setTransferTarget(membership); setTransferConfirmation(""); }}>Make owner</button><button className="text-button danger" type="button" disabled={busy} onClick={() => void removeMember(membership)}>Remove</button></div>}
                  </li>
                ))}
              </ul>
              {invitations.length > 0 && (
                <section className="pending-invitations" aria-labelledby="pending-invitations-title">
                  <div><p className="eyebrow">Pending invitations</p><h3 id="pending-invitations-title">Waiting for {invitations.length}</h3></div>
                  <ul className="member-list">
                    {invitations.map((invitation) => (
                      <li key={invitation.id}>
                        <span className="member-avatar pending" aria-hidden="true">✉</span>
                        <span><strong>{invitation.email}</strong><small>Expires {new Date(invitation.expires_at).toLocaleDateString()}</small></span>
                        <span className={`role-badge ${invitation.role}`}>{invitation.role}</span>
                        <button className="text-button danger" type="button" disabled={busy} onClick={() => void cancelInvitation(invitation)}>Cancel invitation</button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {transferTarget && (
                <section className="ownership-transfer" aria-labelledby="transfer-title">
                  <div><p className="eyebrow">Irreversible role change</p><h3 id="transfer-title">Transfer ownership to {transferTarget.researcher.display_name}</h3><p>They will control members and project deletion. Your account will remain on the project with the role selected below.</p></div>
                  <label>Your new role<select value={previousOwnerRole} onChange={(event) => setPreviousOwnerRole(event.target.value as "editor" | "viewer")}><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label>
                  <label>Type <strong>{project.name}</strong> to confirm<input value={transferConfirmation} onChange={(event) => setTransferConfirmation(event.target.value)} /></label>
                  <div><button className="secondary-button" type="button" onClick={() => setTransferTarget(null)}>Cancel</button><button className="primary-button danger-button" type="button" disabled={busy || transferConfirmation !== project.name} onClick={() => void transferOwnership()}>Transfer ownership</button></div>
                </section>
              )}
            </section>
            <aside className="panel-card audit-panel">
              <p className="eyebrow">Audit log</p><h2>Recent activity</h2>
              <ol>{events.map((event) => <li key={event.id}><span className="audit-dot" /><div><strong>{auditLabels[event.action] ?? event.action}</strong><small>{new Date(event.occurred_at).toLocaleString()}</small></div></li>)}</ol>
              {!events.length && <p>No project activity has been recorded yet.</p>}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function ResearcherLoginPage({
  onAuthenticated,
}: {
  onAuthenticated: (researcher: Researcher) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await api.loginResearcher(email.trim(), password);
      saveResearcherToken(session.access_token);
      await onAuthenticated(session.researcher);
    } catch (loginError) {
      saveResearcherToken(null);
      setError(
        loginError instanceof ApiClientError
          ? loginError.message
          : "Sign in could not be completed. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="researcher-sign-in-title">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">◉</span>
          <span>WebGaze Research</span>
        </div>
        <div>
          <p className="eyebrow">Researcher workspace</p>
          <h1 id="researcher-sign-in-title">Sign in to your studies</h1>
          <p>Manage study protocols, participant links, and consented research results.</p>
        </div>
        {error && <div className="notice error" role="alert">{error}</div>}
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              minLength={12}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="auth-privacy-note">
          Researcher access is separate from participant sessions. Participant links do not expose
          this account or its credentials.
        </p>
      </section>
    </main>
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
