const pageContext = () => ({
  viewport: { width: innerWidth, height: innerHeight },
  scroll: { x: scrollX, y: scrollY },
});
const send = (type, detail = null) => {
  if (!chrome.runtime?.id) return Promise.resolve(null);
  try {
    return chrome.runtime
      .sendMessage({
        type: "PAGE_EVENT",
        event: { type, detail: { ...pageContext(), value: detail }, url: location.href },
      })
      .catch(() => null);
  } catch {
    // Reloading an unpacked extension invalidates scripts already injected into
    // open tabs. Ignore passive telemetry until the participant refreshes.
    return Promise.resolve(null);
  }
};
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
  void chrome.runtime
    .sendMessage({ type: "STUDY_STATUS" })
    .then(async (result) => {
      if (result?.state?.participantToken !== participantMatch[1]) {
        result = await chrome.runtime.sendMessage({
          type: "CONNECT_STUDY",
          participantLink: location.href,
        });
      }
      markExtension(result?.ok && result?.state?.connected ? "connected" : "installed");
    })
    .catch(() => markExtension("installed"));
}
