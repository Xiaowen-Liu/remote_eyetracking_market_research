import type { Request } from "@playwright/test";

import { expect, test } from "./extension.fixture";

test("connects a participant link and arms the study page after consent", async ({
  context,
  extensionId,
  extensionWorker,
}) => {
  const apiBase = "http://localhost:8000";
  const participantToken = "e2e-capability-token";
  const targetUrl = "https://study-target.test/task";
  const sessionId = "00000000-0000-4000-8000-000000000201";
  const apiRequests: Request[] = [];

  await context.route(`${apiBase}/api/v1/**`, async (route) => {
    const request = route.request();
    apiRequests.push(request);
    const path = new URL(request.url()).pathname;

    if (path === `/api/v1/participate/${participantToken}`) {
      await route.fulfill({
        json: {
          title: "Extension E2E study",
          consent_version: "e2e-v1",
          consent_text: "I consent to coordinate-only gaze estimation for this automated test.",
          collection_policy: {
            webcam_gaze_enabled: true,
            screenshots_enabled: false,
            sample_interval_ms: 100,
          },
          tasks: [
            {
              position: 1,
              title: "Inspect navigation",
              prompt: "Find the navigation landmark.",
              start_url: targetUrl,
            },
          ],
        },
      });
      return;
    }

    if (path === `/api/v1/participate/${participantToken}/sessions`) {
      await route.fulfill({ json: { id: sessionId, access_token: "e2e-access-token" } });
      return;
    }

    if (path === `/api/v1/participant-sessions/${sessionId}/consent`) {
      await route.fulfill({ json: { lifecycle: "calibrating" } });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: { message: "Unexpected E2E API request" } },
    });
  });
  await context.route("https://study-target.test/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><main><h1>Study target</h1></main></body></html>",
    });
  });

  const target = await context.newPage();
  await target.goto(targetUrl);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup
    .getByLabel("Participant link")
    .fill(`https://webgaze-research.vercel.app/participate/${participantToken}`);
  await popup.getByLabel("API base").fill(apiBase);
  await popup.getByRole("button", { name: "Connect study" }).click();

  await expect(popup.getByRole("heading", { name: "Extension E2E study" })).toBeVisible();
  await expect(
    popup.getByText("I consent to coordinate-only gaze estimation for this automated test."),
  ).toBeVisible();
  await popup.getByLabel("I have read and accept this consent.").check();

  await target.bringToFront();
  const accepted = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "ACCEPT_CONSENT" }),
  );
  expect(accepted.ok).toBe(true);

  await expect(target.locator("#webgaze-collector-overlay")).toBeVisible();
  await expect(target.getByRole("heading", { name: "Check your camera" })).toBeVisible();
  await expect(target.getByRole("button", { name: "Start camera check" })).toBeVisible();

  const stored = await extensionWorker.evaluate(async () => {
    const key = "webgaze.experimental.collector.session";
    return (await chrome.storage.session.get(key))[key];
  });
  expect(stored).toMatchObject({
    sessionId,
    accessToken: "e2e-access-token",
    phase: "calibrating",
  });

  const consentRequest = apiRequests.find((request) =>
    request.url().endsWith(`/participant-sessions/${sessionId}/consent`),
  );
  expect(consentRequest?.headers().authorization).toBe("Bearer e2e-access-token");
});

test("completes calibration, retries ordered gaze batches, submits, and exports safely", async ({
  context,
  extensionId,
}) => {
  const apiBase = "http://localhost:8000";
  const participantToken = "lifecycle-capability-token";
  const targetUrl = "https://lifecycle-target.test/task";
  const sessionId = "00000000-0000-4000-8000-000000000301";
  const taskRunId = "00000000-0000-4000-8000-000000000302";
  const calibrationBodies: Array<Record<string, unknown>> = [];
  const gazeBodies: Array<Record<string, unknown>> = [];
  const authorizedPaths: string[] = [];
  let failFirstGazeRequest = true;

  await context.route(`${apiBase}/api/v1/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.headers().authorization === "Bearer lifecycle-access-token") {
      authorizedPaths.push(path);
    }

    if (path === `/api/v1/participate/${participantToken}`) {
      await route.fulfill({
        json: {
          title: "Lifecycle E2E study",
          consent_version: "lifecycle-v1",
          consent_text: "I consent to this automated lifecycle test.",
          collection_policy: {
            webcam_gaze_enabled: true,
            screenshots_enabled: false,
            sample_interval_ms: 100,
          },
          tasks: [
            {
              position: 1,
              title: "Inspect navigation",
              prompt: "Find the navigation landmark.",
              start_url: targetUrl,
            },
          ],
        },
      });
      return;
    }
    if (path === `/api/v1/participate/${participantToken}/sessions`) {
      await route.fulfill({ json: { id: sessionId, access_token: "lifecycle-access-token" } });
      return;
    }
    if (path === `/api/v1/participant-sessions/${sessionId}/consent`) {
      await route.fulfill({ json: { lifecycle: "calibrating" } });
      return;
    }
    if (path === `/api/v1/participant-sessions/${sessionId}/calibrations`) {
      calibrationBodies.push(request.postDataJSON());
      await route.fulfill({
        json: {
          attempt: 1,
          observed_sample_count: 45,
          error_px: 38,
          quality_grade: "strong",
          accepted: true,
        },
      });
      return;
    }
    if (
      path === `/api/v1/participant-sessions/${sessionId}/task-runs` &&
      request.method() === "POST"
    ) {
      await route.fulfill({ json: { id: taskRunId, task_position: 1, lifecycle: "running" } });
      return;
    }
    if (path === `/api/v1/participant-sessions/${sessionId}/gaze-batches`) {
      gazeBodies.push(request.postDataJSON());
      if (failFirstGazeRequest) {
        failFirstGazeRequest = false;
        await route.fulfill({
          status: 503,
          json: { error: { message: "Temporary ingestion failure" } },
        });
      } else {
        await route.fulfill({ json: { accepted: true } });
      }
      return;
    }
    if (path === `/api/v1/participant-sessions/${sessionId}/task-runs/${taskRunId}/complete`) {
      await route.fulfill({ json: { id: taskRunId, lifecycle: "completed" } });
      return;
    }
    if (path === `/api/v1/participant-sessions/${sessionId}/submit`) {
      await route.fulfill({ json: { lifecycle: "submitted", analysis_job_id: "analysis-e2e" } });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { error: { message: `Unexpected E2E API request: ${path}` } },
    });
  });
  await context.route("https://lifecycle-target.test/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><main><h1>Lifecycle target</h1></main></body></html>",
    });
  });

  const target = await context.newPage();
  await target.goto(targetUrl);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByLabel("Participant link").fill(participantToken);
  await popup.getByLabel("API base").fill(apiBase);
  await popup.getByRole("button", { name: "Connect study" }).click();
  await popup.getByLabel("I have read and accept this consent.").check();
  await target.bringToFront();
  expect(
    (await popup.evaluate(() => chrome.runtime.sendMessage({ type: "ACCEPT_CONSENT" }))).ok,
  ).toBe(true);
  await expect(target.locator("#webgaze-collector-overlay")).toBeVisible();

  const calibration = await popup.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "CALIBRATION_COMPLETED",
      calibration: {
        startedAt: "2026-09-13T12:00:00.000Z",
        completedAt: "2026-09-13T12:00:08.000Z",
        observedSampleCount: 45,
        errorPx: 38,
        qualityGrade: "strong",
        rms: 0.03,
      },
    }),
  );
  expect(calibration).toMatchObject({ ok: true, accepted: true, state: { phase: "ready" } });
  expect(calibrationBodies[0]).toMatchObject({
    attempt: 1,
    target_count: 9,
    diagnostics: { source: "clean-room-extension", camera_frames_uploaded: false },
  });

  await target.bringToFront();
  const started = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "START_STUDY_TASK" }),
  );
  expect(started).toMatchObject({ ok: true, state: { phase: "running" } });
  await expect(
    target.getByText("Collecting coordinate estimates for Inspect navigation."),
  ).toBeVisible();

  const sampleBatch = (offset: number) =>
    Array.from({ length: 12 }, (_, index) => ({
      x: 0.25 + index * 0.02,
      y: 0.35 + index * 0.015,
      confidence: 0.88,
      at: new Date(Date.parse("2026-09-13T12:00:10.000Z") + (offset + index) * 100).toISOString(),
      url: targetUrl,
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0 },
    }));
  const firstBatch = await popup.evaluate(
    (samples) => chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }),
    sampleBatch(0),
  );
  expect(firstBatch).toMatchObject({ ok: false, error: "Temporary ingestion failure" });
  const secondBatch = await popup.evaluate(
    (samples) => chrome.runtime.sendMessage({ type: "GAZE_SAMPLES", samples }),
    sampleBatch(12),
  );
  expect(secondBatch).toMatchObject({ ok: true });

  expect(gazeBodies.map((body) => body.sequence)).toEqual([0, 0, 1]);
  expect(gazeBodies[1].client_batch_id).toBe(gazeBodies[0].client_batch_id);
  expect(gazeBodies[2].client_batch_id).not.toBe(gazeBodies[1].client_batch_id);

  await target.bringToFront();
  const completed = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "COMPLETE_STUDY_TASK" }),
  );
  expect(completed).toMatchObject({
    ok: true,
    state: { phase: "ready", completedTasks: 1, nextTask: null },
  });
  const submitted = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "SUBMIT_STUDY" }),
  );
  expect(submitted).toMatchObject({ ok: true, state: { phase: "submitted" } });

  const downloaded = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "DOWNLOAD_ARTIFACT" }),
  );
  expect(downloaded).toMatchObject({ ok: true, state: { phase: "submitted" } });
  expect(downloaded.artifact).toMatchObject({
    schemaVersion: "1.0",
    sessionId,
    gazeSamples: expect.any(Array),
    calibration: { quality_grade: "strong", accepted: true },
    privacy: { rawCameraVideo: false, eventCollection: true, visibleTabSnapshots: false },
  });
  expect(downloaded.artifact.gazeSamples).toHaveLength(24);
  for (const secret of [
    "apiBase",
    "accessToken",
    "participantToken",
    "protocol",
    "pendingBatches",
    "taskRun",
    "lastError",
  ]) {
    expect(downloaded.artifact).not.toHaveProperty(secret);
  }

  expect(authorizedPaths).toEqual(
    expect.arrayContaining([
      `/api/v1/participant-sessions/${sessionId}/consent`,
      `/api/v1/participant-sessions/${sessionId}/calibrations`,
      `/api/v1/participant-sessions/${sessionId}/task-runs`,
      `/api/v1/participant-sessions/${sessionId}/gaze-batches`,
      `/api/v1/participant-sessions/${sessionId}/task-runs/${taskRunId}/complete`,
      `/api/v1/participant-sessions/${sessionId}/submit`,
    ]),
  );
});
