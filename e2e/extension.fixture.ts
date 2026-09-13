import path from "node:path";
import {
  chromium,
  test as base,
  type BrowserContext,
  type Worker,
} from "@playwright/test";

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  extensionWorker: Worker;
}>({
  context: async ({}, use) => {
    const extensionPath = path.resolve("collector-extension");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    await use(context);
    await context.close();
  },
  extensionWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    await use(worker);
  },
  extensionId: async ({ extensionWorker }, use) => {
    await use(new URL(extensionWorker.url()).host);
  },
});

export { expect } from "@playwright/test";
