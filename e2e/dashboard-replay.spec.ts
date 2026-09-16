import { expect, test } from "@playwright/test";

test("imports a real extension artifact and exposes replay health", async ({ page }) => {
  const projectId = "00000000-0000-4000-8000-000000000010";
  const studyId = "00000000-0000-4000-8000-000000000020";
  const createdAt = "2026-09-13T12:00:00.000Z";

  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/projects") {
      await route.fulfill({
        json: {
          items: [{
            id: projectId,
            owner_id: "00000000-0000-4000-8000-000000000001",
            name: "Extension research",
            research_question: "How do people inspect navigation?",
            status: "active",
            created_at: createdAt,
            updated_at: createdAt,
          }],
          total: 1,
        },
      });
      return;
    }
    if (path === `/api/v1/projects/${projectId}/studies`) {
      await route.fulfill({ json: { items: [{ id: studyId }], total: 1 } });
      return;
    }
    if (path === `/api/v1/projects/${projectId}/access`) {
      await route.fulfill({
        json: {
          project_id: projectId,
          role: "owner",
          can_edit: true,
          can_manage_members: true,
          can_delete: true,
        },
      });
      return;
    }
    if (path === `/api/v1/studies/${studyId}/draft`) {
      await route.fulfill({
        json: {
          id: studyId,
          project_id: projectId,
          lifecycle: "published",
          draft_revision: 1,
          current_published_version: 1,
          created_at: createdAt,
          updated_at: createdAt,
          title: "Extension E2E study",
          description: "A browser-level study journey.",
          consent_version: "e2e-v1",
          consent_text: "I consent to coordinate-only gaze estimation.",
          target_origins: ["https://study-target.test"],
          calibration_policy: { minimum_quality: "variable", allow_retry: true, maximum_attempts: 3 },
          collection_policy: { screenshots_enabled: true, sample_interval_ms: 100, webcam_gaze_enabled: true },
          retention_days: 30,
          tasks: [{
            position: 1,
            title: "Inspect navigation",
            prompt: "Find the navigation landmark.",
            start_url: "https://study-target.test/task",
            success_url_pattern: null,
            time_limit_ms: 120000,
            areas_of_interest: [],
          }],
        },
      });
      return;
    }
    if (path === `/api/v1/studies/${studyId}/participant-link`) {
      await route.fulfill({ json: { participant_url: "/participate/e2e-capability-token" } });
      return;
    }
    if (path === `/api/v1/studies/${studyId}/analysis-jobs`
      || path === `/api/v1/studies/${studyId}/participant-sessions`) {
      await route.fulfill({ json: { items: [], total: 0 } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected E2E route: ${path}` } } });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Extension E2E study" })).toBeVisible();
  await page.getByRole("button", { name: "View results" }).click();
  await expect(page.getByRole("heading", { name: "Research results" })).toBeVisible();

  const startedAt = Date.parse(createdAt);
  const artifact = {
    schemaVersion: "1.0",
    sessionId: "extension-e2e-session",
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(startedAt + 10_000).toISOString(),
    captureSnapshots: true,
    events: [{
      type: "page-open",
      url: "https://study-target.test/task",
      at: new Date(startedAt + 100).toISOString(),
      detail: { viewport: { width: 1280, height: 720 }, scroll: { x: 0, y: 0 } },
    }],
    snapshots: [{
      at: new Date(startedAt + 500).toISOString(),
      url: "https://study-target.test/task",
      reason: "page-open",
      dataUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0 },
    }],
    gazeSamples: Array.from({ length: 80 }, (_, index) => ({
      x: 0.25 + (index % 10) * 0.045,
      y: 0.3 + (index % 8) * 0.05,
      at: new Date(startedAt + index * 125).toISOString(),
      confidence: 0.88,
      url: "https://study-target.test/task",
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0 },
    })),
    calibration: {
      attempt: 1,
      observed_sample_count: 45,
      error_px: 38,
      quality_grade: "strong",
      accepted: true,
    },
    privacy: { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: true },
  };

  await page.locator("summary[aria-label='Workspace actions']").click();
  await page.locator(".workspace-action-import input").setInputFiles({
    name: "webgaze-extension-artifact.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(artifact)),
  });

  await expect(page.getByText("Tracking health: good")).toBeVisible();
  await expect(page.getByText("Calibration strong")).toBeVisible();
  await expect(page.getByText("80 estimated samples")).toBeVisible();
  await expect(page.getByText("1 timeline events")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Replay canvas" })).toBeVisible();
});
