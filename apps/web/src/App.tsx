import { useEffect, useRef, useState } from "react";

import {
  api,
  ApiClientError,
  type Project,
  type StudyDraft,
  type StudyDraftResponse,
} from "./api";

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
  collection_policy: { screenshots_enabled: false, sample_interval_ms: 100 },
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

export function App() {
  const bootstrapStarted = useRef(false);
  const [project, setProject] = useState<Project | null>(null);
  const [study, setStudy] = useState<StudyDraftResponse | null>(null);
  const [draft, setDraft] = useState<StudyDraft>(emptyDraft);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [participantUrl, setParticipantUrl] = useState<string | null>(null);

  useEffect(() => {
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      const projects = await api.listProjects();
      const current =
        projects.items[0] ?? (await api.createProject("Checkout UX research"));
      setProject(current);
      const studies = await api.listStudies(current.id);
      if (studies.items[0]) {
        const existing = await api.getDraft(studies.items[0].id);
        setStudy(existing);
        setDraft(toDraft(existing));
        setDirty(false);
        setEditing(existing.current_published_version === null);
        if (existing.current_published_version) {
          const link = await api.getParticipantLink(existing.id);
          setParticipantUrl(link.participant_url);
        }
      }
    } catch (error) {
      showError(error);
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
    await navigator.clipboard.writeText(absoluteUrl);
    setNotice({ kind: "success", text: "Participant link copied." });
  }

  const publishedVersion = study?.current_published_version ?? null;
  const isLocked = publishedVersion !== null && !editing;

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
          <span>Projects</span><span>/</span>
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
                  : `Editing · v${publishedVersion + 1}`
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
                  <button className="secondary-button" type="button" onClick={addTask}>
                    + Add task
                  </button>
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
                      className="primary-button"
                      onClick={() => void copyParticipantLink()}
                    >
                      Copy participant link
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
                      text: `Editing a new draft. Version ${publishedVersion} remains live.`,
                    });
                  }}
                >
                  Create revision
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
                    ? `Publish version ${publishedVersion + 1}`
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
