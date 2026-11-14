import { DEFAULT_BASE, normalizeBase } from "./lib/share.js";

for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = chrome.i18n.getMessage(el.dataset.i18n);
const input = document.getElementById("base");
input.value = (await chrome.storage.sync.get({ base: DEFAULT_BASE })).base;
document.getElementById("save").addEventListener("click", async () => {
  const base = normalizeBase(input.value);
  input.value = base;
  await chrome.storage.sync.set({ base });
  document.getElementById("status").textContent = chrome.i18n.getMessage("saved");
});
