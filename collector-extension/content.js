const pageContext = () => ({ viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } });
const send = (type, detail = null) => chrome.runtime.sendMessage({ type: "PAGE_EVENT", event: { type, detail: { ...pageContext(), value: detail }, url: location.href } });
let scrollTimer;
addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => send("scroll-settled", { x: scrollX, y: scrollY }), 250); }, { passive: true });
addEventListener("popstate", () => send("history-navigation"));
addEventListener("hashchange", () => send("hash-navigation"));
let mutationTimer;
new MutationObserver((entries) => {
  const pageEntries = entries.filter((entry) => !entry.target.closest?.("#webgaze-collector-overlay"));
  if (!pageEntries.some((entry) => entry.addedNodes.length || entry.removedNodes.length)) return;
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => send("dom-change", { count: pageEntries.length }), 250);
}).observe(document.documentElement, { childList: true, subtree: true });
send("page-open");
