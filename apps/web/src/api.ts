import type { components } from "../../../packages/api-contract/src/schema";

export type Project = components["schemas"]["ProjectResponse"];
export type StudyDraft = components["schemas"]["StudyDraft"];
export type StudyDraftResponse = components["schemas"]["StudyDraftResponse"];
export type StudySummary = components["schemas"]["StudySummary"];
export type PublishResponse = components["schemas"]["PublishResponse"];
export type ParticipantLink = components["schemas"]["ParticipantLinkResponse"];

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
};
