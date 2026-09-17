const pageContext = () => ({
  viewport: { width: innerWidth, height: innerHeight },
  scroll: { x: scrollX, y: scrollY },
});
let contextInvalidated = false;
const showContextRecovery = () => {
  if (contextInvalidated) return;
  contextInvalidated = true;
  document.querySelector("#webgaze-collector-overlay")?.remove();
  document.querySelector("#webgaze-context-recovery")?.remove();
  const notice = document.createElement("aside");
  notice.id = "webgaze-context-recovery";
  notice.setAttribute("role", "alert");
  notice.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:360px;padding:16px 18px;border:1px solid #cad8c6;border-radius:10px;background:#fff;color:#1d3727;box-shadow:0 12px 34px #20362033;font:14px/1.45 Inter,system-ui,sans-serif";
  notice.innerHTML =
    "<strong style='display:block;margin-bottom:5px'>WebGaze extension updated</strong><span>The previous calibration tab can no longer communicate with the extension. Refresh this page to reconnect and restart calibration.</span><button type='button' style='display:block;margin-top:12px;padding:8px 12px;border:0;border-radius:6px;background:#1d3727;color:#fff;font:inherit;font-weight:700;cursor:pointer'>Refresh page</button>";
  notice.querySelector("button").addEventListener("click", () => location.reload());
  document.documentElement.append(notice);
};
const invalidated = (error) => /extension context invalidated/i.test(String(error));
const runtimeMessage = (message) => {
  if (contextInvalidated) return Promise.resolve(null);
  try {
    if (!chrome.runtime?.id) {
      showContextRecovery();
      return Promise.resolve(null);
    }
    return chrome.runtime.sendMessage(message).catch((error) => {
      if (invalidated(error)) showContextRecovery();
      return null;
    });
  } catch (error) {
    if (invalidated(error)) showContextRecovery();
    return Promise.resolve(null);
  }
};
const send = (type, detail = null) =>
  runtimeMessage({
    type: "PAGE_EVENT",
    event: { type, detail: { ...pageContext(), value: detail }, url: location.href },
  });
const domProposals = () =>
  [
    ...document.querySelectorAll(
      "main,nav,header,aside,article,section,form,button,a,input,textarea,select",
    ),
  ]
    .filter((element) => !element.closest("#webgaze-collector-overlay"))
    .map((element, index) => {
      const rect = element.getBoundingClientRect();
      const label =
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ||
        `${element.tagName.toLowerCase()} ${index + 1}`;
      return {
        label,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        x: rect.left / innerWidth,
        y: rect.top / innerHeight,
        width: rect.width / innerWidth,
        height: rect.height / innerHeight,
      };
    })
    .filter(
      (proposal) =>
        proposal.width >= 0.03 &&
        proposal.height >= 0.025 &&
        proposal.x < 1 &&
        proposal.y < 1 &&
        proposal.x + proposal.width > 0 &&
        proposal.y + proposal.height > 0,
    )
    .slice(0, 40);
const screenState = (trigger) => ({ trigger, proposals: domProposals() });
let scrollTimer;
addEventListener(
  "scroll",
  () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => send("scroll-settled", { x: scrollX, y: scrollY }), 250);
  },
  { passive: true },
);
addEventListener("popstate", () => send("history-navigation"));
addEventListener("hashchange", () => send("hash-navigation"));
let mutationTimer;
new MutationObserver((entries) => {
  const pageEntries = entries.filter(
    (entry) => !entry.target.closest?.("#webgaze-collector-overlay"),
  );
  if (!pageEntries.some((entry) => entry.addedNodes.length || entry.removedNodes.length)) return;
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(
    () => send("dom-change", { count: pageEntries.length, ...screenState("dom-change") }),
    250,
  );
}).observe(document.documentElement, { childList: true, subtree: true });
send("page-open", screenState("page-open"));

const participantMatch = location.pathname.match(/^\/(?:api\/v1\/)?participate\/([^/]+)$/);
if (participantMatch) {
  const markExtension = (status) => {
    document.documentElement.dataset.webgazeExtensionStatus = status;
    document.dispatchEvent(new Event("webgaze-extension-status"));
  };
  markExtension("installed");
  void runtimeMessage({ type: "STUDY_STATUS" })
    .then(async (result) => {
      if (result?.state?.participantToken !== participantMatch[1]) {
        result = await runtimeMessage({
          type: "CONNECT_STUDY",
          participantLink: location.href,
        });
      }
      markExtension(result?.ok && result?.state?.connected ? "connected" : "installed");
    })
    .catch(() => markExtension("installed"));
}
