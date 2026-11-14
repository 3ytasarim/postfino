import { buildShareUrl, DEFAULT_BASE } from "./lib/share.js";

const base = async () => (await chrome.storage.sync.get({ base: DEFAULT_BASE })).base;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "st-page", title: chrome.i18n.getMessage("menuPage"), contexts: ["page", "link"] });
  chrome.contextMenus.create({ id: "st-image", title: chrome.i18n.getMessage("menuImage"), contexts: ["image"] });
  chrome.contextMenus.create({ id: "st-selection", title: chrome.i18n.getMessage("menuSelection"), contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const payload = {
    title: tab?.title,
    url: info.linkUrl ?? info.pageUrl ?? tab?.url,
    text: info.menuItemId === "st-selection" ? info.selectionText : undefined,
    image: info.menuItemId === "st-image" ? info.srcUrl : undefined,
  };
  await chrome.tabs.create({ url: buildShareUrl(await base(), payload), index: tab ? tab.index + 1 : undefined });
});
