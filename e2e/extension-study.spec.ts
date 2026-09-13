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

    await route.fulfill({ status: 404, json: { error: { message: "Unexpected E2E API request" } } });
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
  await popup.getByLabel("Participant link").fill(`https://webgaze-research.vercel.app/participate/${participantToken}`);
  await popup.getByLabel("API base").fill(apiBase);
  await popup.getByRole("button", { name: "Connect study" }).click();

  await expect(popup.getByRole("heading", { name: "Extension E2E study" })).toBeVisible();
  await expect(popup.getByText("I consent to coordinate-only gaze estimation for this automated test.")).toBeVisible();
  await popup.getByLabel("I have read and accept this consent.").check();

  await target.bringToFront();
  const accepted = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "ACCEPT_CONSENT" }));
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
