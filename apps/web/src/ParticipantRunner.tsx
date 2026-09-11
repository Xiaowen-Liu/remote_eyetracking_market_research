import { useEffect, useRef, useState } from "react";

import { enqueueBatch, flushPendingBatches, pendingBatches } from "./collection";
import {
  api,
  ApiClientError,
  type GazeBatchCreate,
  type PublicStudyProtocol,
  type SessionSubmit,
  type TaskRun,
} from "./api";
import { LiveGazeCapture } from "./LiveGazeCapture";
import type { GazeFeature } from "./gazeMath";

type Phase = "loading" | "consent" | "calibration" | "ready" | "running" | "submitting" | "complete" | "error";
type Notice = { kind: "success" | "error"; text: string } | null;
type AccessSession = { id: string; accessToken: string };
type StoredSession = AccessSession & {
  phase: Phase;
  nextSequence: number;
  completedTasks: number;
  activeRun: TaskRun | null;
};

const storageKey = (token: string) => `webgaze.participant-session.v1.${token}`;

function readStoredSession(token: string): StoredSession | null {
  const raw = window.sessionStorage.getItem(storageKey(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function participantTokenFromPath(pathname = window.location.pathname) {
  return pathname.match(/^\/(?:api\/v1\/)?participate\/([^/]+)$/)?.[1] ?? null;
}

export function ParticipantRunner({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [protocol, setProtocol] = useState<PublicStudyProtocol | null>(null);
  const [session, setSession] = useState<AccessSession | null>(null);
  const [activeRun, setActiveRun] = useState<TaskRun | null>(null);
  const [completedTasks, setCompletedTasks] = useState(0);
  const [nextSequence, setNextSequence] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [offlineDemo, setOfflineDemo] = useState(false);
  const [calibrationAttempt, setCalibrationAttempt] = useState(1);
  const [submission, setSubmission] = useState<SessionSubmit | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const sequenceRef = useRef(0);

  function persist(
    nextPhase: Phase,
    nextSession: AccessSession,
    overrides: Partial<Omit<StoredSession, "id" | "accessToken" | "phase">> = {},
  ) {
    const value: StoredSession = {
      ...nextSession,
      phase: nextPhase,
      nextSequence,
      completedTasks,
      activeRun,
      ...overrides,
    };
    window.sessionStorage.setItem(storageKey(token), JSON.stringify(value));
  }

  function showError(error: unknown) {
    const message = error instanceof ApiClientError ? error.message : "Connection failed. Your queue is still safe in this browser.";
    setNotice({ kind: "error", text: message });
  }

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const resolved = await api.resolveParticipantLink(token);
        if (cancelled) return;
        setProtocol(resolved);
        const stored = readStoredSession(token);
        if (stored) {
          setSession({ id: stored.id, accessToken: stored.accessToken });
          setPhase(stored.phase === "running" && !stored.activeRun ? "ready" : stored.phase);
          setNextSequence(stored.nextSequence);
          sequenceRef.current = stored.nextSequence;
          setCompletedTasks(stored.completedTasks);
          setActiveRun(stored.activeRun);
          setPendingCount(pendingBatches(window.localStorage, stored.id).length);
          return;
        }
        const created = await api.createParticipantSession(token);
        if (cancelled || !created.access_token) return;
        const newSession = { id: created.id, accessToken: created.access_token };
        setSession(newSession);
        setPhase("consent");
        persist("consent", newSession, { nextSequence: 0, completedTasks: 0, activeRun: null });
      } catch (error) {
        if (!cancelled) {
          showError(error);
          setPhase("error");
        }
      }
    }
    void bootstrap();
    return () => { cancelled = true; };
  }, [token]);

  async function acceptConsent() {
    if (!session || !protocol) return;
    setBusy(true);
    try {
      await api.recordConsent(session.id, session.accessToken, protocol.consent_version);
      setPhase("calibration");
      persist("calibration", session);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function completeCalibration() {
    if (!session) return;
    setBusy(true);
    try {
      const result = await api.recordCalibration(
        session.id,
        session.accessToken,
        calibrationAttempt,
        new Date(Date.now() - 12_000).toISOString(),
      );
      if (!result.accepted) {
        setCalibrationAttempt((attempt) => attempt + 1);
        setNotice({ kind: "error", text: "Calibration did not meet this protocol's threshold. Try again." });
        return;
      }
      setPhase("ready");
      persist("ready", session);
      setNotice({ kind: "success", text: "Calibration accepted. You can start the first task." });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function startTask() {
    if (!session || !protocol) return;
    setBusy(true);
    try {
      const run = await api.startTask(session.id, session.accessToken, completedTasks + 1);
      setActiveRun(run);
      setPhase("running");
      persist("running", session, { activeRun: run });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function flush() {
    if (!session || offlineDemo) return 0;
    try {
      const sent = await flushPendingBatches(window.localStorage, session.id, (batch) =>
        api.ingestGazeBatch(session.id, session.accessToken, batch),
      );
      setPendingCount(pendingBatches(window.localStorage, session.id).length);
      if (sent) setNotice({ kind: "success", text: `${sent} buffered gaze batch${sent === 1 ? "" : "es"} uploaded.` });
      return sent;
    } catch (error) {
      setPendingCount(pendingBatches(window.localStorage, session.id).length);
      showError(error);
      return 0;
    }
  }

  async function recordSyntheticSample() {
    if (!session || !activeRun) return;
    const now = new Date().toISOString();
    const batch: GazeBatchCreate = {
      client_batch_id: crypto.randomUUID(),
      sequence: nextSequence,
      schema_version: "1.0",
      captured_from: now,
      captured_to: now,
      samples: [{
        timestamp: now,
        x_normalized: 0.2 + (nextSequence % 3) * 0.25,
        y_normalized: 0.4 + (nextSequence % 2) * 0.2,
        confidence: 0.91,
        scroll_x: 0,
        scroll_y: 0,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
      }],
    };
    enqueueBatch(window.localStorage, session.id, batch);
    const newSequence = nextSequence + 1;
    setNextSequence(newSequence);
    sequenceRef.current = newSequence;
    setPendingCount(pendingBatches(window.localStorage, session.id).length);
    persist("running", session, { nextSequence: newSequence, activeRun });
    if (offlineDemo) {
      setNotice({ kind: "success", text: "Sample buffered locally. Reconnect to upload it." });
    } else {
      await flush();
    }
  }

  function recordLiveSample(point: GazeFeature, confidence: number) {
    if (!session || !activeRun || offlineDemo) return;
    const now = new Date().toISOString();
    const sequence = sequenceRef.current;
    const batch: GazeBatchCreate = {
      client_batch_id: crypto.randomUUID(), sequence, schema_version: "1.0", captured_from: now, captured_to: now,
      samples: [{ timestamp: now, x_normalized: point[0], y_normalized: point[1], confidence, scroll_x: window.scrollX, scroll_y: window.scrollY, viewport_width: window.innerWidth, viewport_height: window.innerHeight }],
    };
    sequenceRef.current += 1;
    setNextSequence(sequenceRef.current);
    enqueueBatch(window.localStorage, session.id, batch);
    setPendingCount(pendingBatches(window.localStorage, session.id).length);
    persist("running", session, { nextSequence: sequenceRef.current, activeRun });
    void flush();
  }

  async function finishTask() {
    if (!session || !activeRun || !protocol) return;
    if (offlineDemo || pendingBatches(window.localStorage, session.id).length > 0) {
      setNotice({ kind: "error", text: "Reconnect and flush all buffered batches before finishing this task." });
      return;
    }
    setBusy(true);
    try {
      await api.completeTask(session.id, session.accessToken, activeRun.id);
      const nextCompleted = completedTasks + 1;
      const nextPhase: Phase = nextCompleted === protocol.tasks.length ? "submitting" : "ready";
      setCompletedTasks(nextCompleted);
      setActiveRun(null);
      setPhase(nextPhase);
      persist(nextPhase, session, { completedTasks: nextCompleted, activeRun: null });
      if (nextPhase === "submitting") await submitForAnalysis();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function submitForAnalysis() {
    if (!session) return;
    setBusy(true);
    try {
      const submitted = await api.submitSession(session.id, session.accessToken);
      setSubmission(submitted);
      setPhase("complete");
      persist("complete", session, { activeRun: null });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  const task = protocol?.tasks[completedTasks];
  const experimentalWebcam = Boolean(protocol?.collection_policy.webcam_gaze_enabled);
  return (
    <main className="participant-shell">
      <header className="participant-header">
        <a className="brand" href="/">◉ WebGaze Research</a>
        <span className="environment">Participant demo</span>
      </header>
      <section className="participant-card" aria-live="polite">
        {phase === "loading" && <p>Preparing your study…</p>}
        {phase === "error" && <><h1>Study unavailable</h1><p>Please check the participant link and try again.</p></>}
        {protocol && phase !== "loading" && phase !== "error" && <>
          <p className="eyebrow">{phase === "running" ? `Task ${completedTasks + 1}` : "Participant study"}</p>
          <h1>{protocol.title}</h1>
          {notice && <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</div>}
          {experimentalWebcam && (phase === "calibration" || phase === "ready" || phase === "running") && <LiveGazeCapture collecting={phase === "running"} sampleIntervalMs={protocol.collection_policy.sample_interval_ms} onGazeSample={recordLiveSample} onCalibrated={() => void completeCalibration()} />}

          {phase === "consent" && <>
            <p>{protocol.consent_text}</p>
            <ul className="participant-facts">
              <li>{experimentalWebcam ? "If enabled, webcam frames are processed only in this browser." : "Webcam frames stay on-device in this public demo."}</li>
              <li>{experimentalWebcam ? "After calibration, estimated coordinate samples are sent to this study API; no camera frames are uploaded." : "Synthetic gaze coordinates are used to demonstrate the API flow."}</li>
              <li>You may leave before task completion.</li>
            </ul>
            <button className="primary-button" disabled={busy} onClick={() => void acceptConsent()}>Accept and continue</button>
          </>}

          {phase === "calibration" && <>
            {experimentalWebcam ? <><p>Use your webcam to complete a local nine-point calibration before task collection begins.</p><p className="fine-print">This is an experimental browser estimate; it is not validated as a laboratory-grade measurement.</p></> : <><p>Complete a deterministic nine-point calibration simulation before task collection begins.</p><div className="calibration-grid" aria-label="Nine calibration targets">{Array.from({ length: 9 }, (_, index) => <span key={index}>●</span>)}</div><p className="fine-print">Attempt {calibrationAttempt} of {protocol.calibration_policy.maximum_attempts}. This public route sends a synthetic result; it does not claim laboratory-grade accuracy.</p><button className="primary-button" disabled={busy} onClick={() => void completeCalibration()}>Record synthetic calibration</button></>}
          </>}

          {phase === "ready" && task && <>
            <p className="task-label">Next: Task {task.position} of {protocol.tasks.length}</p>
            <h2>{task.title}</h2>
            <p>{task.prompt}</p>
            <p className="fine-print">Task boundaries are stored server-side so later analysis does not infer them from timestamps.</p>
            <button className="primary-button" disabled={busy} onClick={() => void startTask()}>Start task {task.position}</button>
          </>}

          {phase === "running" && task && <>
            <p className="task-label">Task {task.position} is collecting</p>
            <h2>{task.title}</h2>
            <p>{task.prompt}</p>
            <div className="connection-row">
              <span className={offlineDemo ? "connection offline" : "connection online"}>{offlineDemo ? "Offline simulation" : "Connected"}</span>
              <span>{pendingCount} buffered batch{pendingCount === 1 ? "" : "es"}</span>
            </div>
            <button className="secondary-button" type="button" onClick={() => setOfflineDemo((value) => !value)}>{offlineDemo ? "Restore connection" : "Simulate connection loss"}</button>
            {!experimentalWebcam && <button className="secondary-button" type="button" disabled={busy} onClick={() => void recordSyntheticSample()}>Record synthetic gaze sample</button>}
            <button className="secondary-button" type="button" disabled={busy || offlineDemo || pendingCount === 0} onClick={() => void flush()}>Retry buffered batches</button>
            <button className="primary-button" disabled={busy} onClick={() => void finishTask()}>Finish task</button>
          </>}

          {phase === "complete" && <>
            <h2>Analysis queued</h2>
            <p>All task boundaries and acknowledged {experimentalWebcam ? "estimated coordinate" : "synthetic gaze"} batches are stored. This session is queued for versioned task-level analysis.</p>
            {submission && <p className="fine-print">Job {submission.analysis_job.id.slice(0, 8)} · {submission.analysis_job.algorithm_version}</p>}
            <p className="fine-print">No webcam frames were uploaded by this demo.</p>
          </>}

          {phase === "submitting" && <>
            <h2>Ready to queue analysis</h2>
            <p>All tasks are complete. Submit this session to create an analysis job.</p>
            <button className="primary-button" disabled={busy} onClick={() => void submitForAnalysis()}>
              {busy ? "Queueing analysis…" : "Submit for analysis"}
            </button>
          </>}
        </>}
      </section>
    </main>
  );
}
