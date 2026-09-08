import type { components } from "../../../packages/api-contract/src/schema";

export type Project = components["schemas"]["ProjectResponse"];
export type StudyDraft = components["schemas"]["StudyDraft"];
export type StudyDraftResponse = components["schemas"]["StudyDraftResponse"];
export type StudySummary = components["schemas"]["StudySummary"];
export type PublishResponse = components["schemas"]["PublishResponse"];
export type ParticipantLink = components["schemas"]["ParticipantLinkResponse"];
export type PublicStudyProtocol = components["schemas"]["PublicStudyProtocol"];
export type ParticipantSession = components["schemas"]["ParticipantSessionResponse"];
export type CalibrationResult = components["schemas"]["CalibrationResultResponse"];
export type TaskRun = components["schemas"]["TaskRunResponse"];
export type GazeBatchCreate = components["schemas"]["GazeBatchCreate"];
export type GazeBatchResponse = components["schemas"]["GazeBatchResponse"];
export type SessionSubmit = components["schemas"]["SessionSubmitResponse"];
export type AnalysisJob = components["schemas"]["AnalysisJobResponse"];
export type AnalysisResult = components["schemas"]["AnalysisResultResponse"];

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export class ApiClientError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiClientError(
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.code ?? "REQUEST_FAILED",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function participantHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export const api = {
  listProjects: () => request<{ items: Project[]; total: number }>("/projects"),
  createProject: (name: string) =>
    request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        research_question: "How do people visually navigate checkout?",
      }),
    }),
  listStudies: (projectId: string) =>
    request<{ items: StudySummary[]; total: number }>(`/projects/${projectId}/studies`),
  getDraft: (studyId: string) => request<StudyDraftResponse>(`/studies/${studyId}/draft`),
  getParticipantLink: (studyId: string) =>
    request<ParticipantLink>(`/studies/${studyId}/participant-link`),
  createStudy: (projectId: string, draft: StudyDraft) =>
    request<StudyDraftResponse>(`/projects/${projectId}/studies`, {
      method: "POST",
      body: JSON.stringify(draft),
    }),
  replaceDraft: (studyId: string, draft: StudyDraft) =>
    request<StudyDraftResponse>(`/studies/${studyId}/draft`, {
      method: "PUT",
      body: JSON.stringify(draft),
    }),
  publish: (studyId: string) =>
    request<PublishResponse>(`/studies/${studyId}/publish`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    }),
  resolveParticipantLink: (token: string) =>
    request<PublicStudyProtocol>(`/participate/${token}`),
  createParticipantSession: (token: string) =>
    request<ParticipantSession>(`/participate/${token}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        browser_family: navigator.userAgent.includes("Firefox") ? "Firefox" : "Chromium",
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        device_pixel_ratio: window.devicePixelRatio,
      }),
    }),
  recordConsent: (sessionId: string, accessToken: string, consentVersion: string) =>
    request(`/participant-sessions/${sessionId}/consent`, {
      method: "POST",
      headers: participantHeaders(accessToken),
      body: JSON.stringify({ accepted: true, consent_version: consentVersion }),
    }),
  recordCalibration: (
    sessionId: string,
    accessToken: string,
    attempt: number,
    startedAt: string,
  ) =>
    request<CalibrationResult>(`/participant-sessions/${sessionId}/calibrations`, {
      method: "POST",
      headers: participantHeaders(accessToken),
      body: JSON.stringify({
        attempt,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        target_count: 9,
        observed_sample_count: 45,
        error_px: 42,
        quality_grade: "strong",
        diagnostics: { source: "synthetic-public-demo", camera_frames_uploaded: false },
      }),
    }),
  startTask: (sessionId: string, accessToken: string, taskPosition: number) =>
    request<TaskRun>(`/participant-sessions/${sessionId}/task-runs`, {
      method: "POST",
      headers: participantHeaders(accessToken),
      body: JSON.stringify({ task_position: taskPosition }),
    }),
  completeTask: (sessionId: string, accessToken: string, taskRunId: string) =>
    request<TaskRun>(`/participant-sessions/${sessionId}/task-runs/${taskRunId}/complete`, {
      method: "POST",
      headers: participantHeaders(accessToken),
      body: JSON.stringify({ outcome: "completed" }),
    }),
  ingestGazeBatch: (sessionId: string, accessToken: string, batch: GazeBatchCreate) =>
    request<GazeBatchResponse>(`/participant-sessions/${sessionId}/gaze-batches`, {
      method: "POST",
      headers: participantHeaders(accessToken),
      body: JSON.stringify(batch),
    }),
  submitSession: (sessionId: string, accessToken: string) =>
    request<SessionSubmit>(`/participant-sessions/${sessionId}/submit`, {
      method: "POST",
      headers: participantHeaders(accessToken),
    }),
  listStudyAnalysisJobs: (studyId: string) =>
    request<{ items: AnalysisJob[]; total: number }>(`/studies/${studyId}/analysis-jobs`),
  runAnalysisJob: (jobId: string) =>
    request<AnalysisResult>(`/analysis-jobs/${jobId}/run`, { method: "POST" }),
  getAnalysisResult: (jobId: string) => request<AnalysisResult>(`/analysis-jobs/${jobId}/result`),
  createSyntheticStudyResults: (studyId: string) =>
    request<AnalysisResult>(`/studies/${studyId}/synthetic-results`, { method: "POST" }),
};
