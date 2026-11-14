import { buildShareUrl, DEFAULT_BASE } from "./lib/share.js";

for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = chrome.i18n.getMessage(el.dataset.i18n);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
document.getElementById("title").textContent = tab?.title ?? "";
document.getElementById("url").textContent = tab?.url ?? "";
document.getElementById("share").addEventListener("click", async () => {
  const { base } = await chrome.storage.sync.get({ base: DEFAULT_BASE });
  await chrome.tabs.create({ url: buildShareUrl(base, { title: tab?.title, url: tab?.url }) });
  window.close();
});
