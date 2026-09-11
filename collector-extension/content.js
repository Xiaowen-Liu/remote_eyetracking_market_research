const send = (type, detail = null) => chrome.runtime.sendMessage({ type: "PAGE_EVENT", event: { type, detail, url: location.href } });
let scrollTimer;
addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => send("scroll-settled", { x: scrollX, y: scrollY }), 250); }, { passive: true });
addEventListener("popstate", () => send("history-navigation"));
addEventListener("hashchange", () => send("hash-navigation"));
new MutationObserver((entries) => { if (entries.some((entry) => entry.addedNodes.length || entry.removedNodes.length)) send("dom-change", { count: entries.length }); }).observe(document.documentElement, { childList: true, subtree: true });
send("page-open");
