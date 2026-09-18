import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("removes a stale overlay and offers recovery when the extension context is invalidated", async () => {
  const source = await readFile(
    new URL("../collector-extension/content.js", import.meta.url),
    "utf8",
  );
  const removed = [];
  const appended = [];
  const overlay = { remove: () => removed.push("overlay") };
  const button = { addEventListener: () => undefined };
  const document = {
    createElement: () => ({
      addEventListener: () => undefined,
      innerHTML: "",
      querySelector: () => button,
      setAttribute: () => undefined,
      style: {},
    }),
    documentElement: { append: (node) => appended.push(node) },
    querySelector: (selector) => (selector === "#webgaze-collector-overlay" ? overlay : null),
    querySelectorAll: () => [],
  };
  const runtime = {};
  Object.defineProperty(runtime, "id", {
    get() {
      throw new Error("Extension context invalidated.");
    },
  });

  assert.doesNotThrow(() =>
    vm.runInNewContext(source, {
      MutationObserver: class {
        observe() {}
      },
      Promise,
      addEventListener: () => undefined,
      chrome: { runtime },
      clearTimeout: () => undefined,
      document,
      innerHeight: 720,
      innerWidth: 1280,
      location: { href: "https://example.test/pricing", pathname: "/pricing", reload() {} },
      scrollX: 0,
      scrollY: 0,
      setTimeout: () => 1,
    }),
  );
  assert.deepEqual(removed, ["overlay"]);
  assert.equal(appended.length, 1);
  assert.match(appended[0].innerHTML, /Refresh page/);
});

test("moves the calibration-step marker away from boundary before showing the accuracy intro", async () => {
  const source = await readFile(
    new URL("../collector-extension/src/content.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /runtime\.calibrationStage = options\.stage;\s+root\.dataset\.mode = "calibration-intro";\s+root\.dataset\.calibrationStep = options\.stage;/,
  );
});

test("binds task telemetry and gaze samples to the single collector tab", async () => {
  const source = await readFile(
    new URL("../collector-extension/background.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /collectorTabId: tab\.id/);
  assert.match(
    source,
    /message\.type === "GAZE_SAMPLES"[\s\S]*!isCollectorTab\(session, sender\)[\s\S]*session\.phase !== "running"/,
  );
  assert.match(
    source,
    /message\.type === "PAGE_EVENT"[\s\S]*!isCollectorTab\(session, sender\)[\s\S]*session\.phase !== "running"/,
  );
});

test("records a stable canonical DOM key with every proposal", async () => {
  const source = await readFile(
    new URL("../collector-extension/content.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /const canonicalKey = \(element, label\) =>/);
  assert.match(source, /canonicalKey: canonicalKey\(element, label\)/);
});
