const pageContext = () => ({ viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } });
const send = (type, detail = null) => chrome.runtime.sendMessage({ type: "PAGE_EVENT", event: { type, detail: { ...pageContext(), value: detail }, url: location.href } });
const domProposals = () => [...document.querySelectorAll("main,nav,header,aside,article,section,form,button,a,input,textarea,select")]
  .filter((element) => !element.closest("#webgaze-collector-overlay"))
  .map((element, index) => {
    const rect = element.getBoundingClientRect();
    const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) || `${element.tagName.toLowerCase()} ${index + 1}`;
    return { label, tag: element.tagName.toLowerCase(), role: element.getAttribute("role"), x: rect.left / innerWidth, y: rect.top / innerHeight, width: rect.width / innerWidth, height: rect.height / innerHeight };
  })
  .filter((proposal) => proposal.width >= .03 && proposal.height >= .025 && proposal.x < 1 && proposal.y < 1 && proposal.x + proposal.width > 0 && proposal.y + proposal.height > 0)
  .slice(0, 40);
const screenState = (trigger) => ({ trigger, proposals: domProposals() });
let scrollTimer;
addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => send("scroll-settled", { x: scrollX, y: scrollY }), 250); }, { passive: true });
addEventListener("popstate", () => send("history-navigation"));
addEventListener("hashchange", () => send("hash-navigation"));
let mutationTimer;
new MutationObserver((entries) => {
  const pageEntries = entries.filter((entry) => !entry.target.closest?.("#webgaze-collector-overlay"));
  if (!pageEntries.some((entry) => entry.addedNodes.length || entry.removedNodes.length)) return;
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => send("dom-change", { count: pageEntries.length, ...screenState("dom-change") }), 250);
}).observe(document.documentElement, { childList: true, subtree: true });
send("page-open", screenState("page-open"));
