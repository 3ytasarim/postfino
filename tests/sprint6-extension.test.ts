import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "../extension");
// @ts-expect-error plain JS module without types
const share = (await import("../extension/lib/share.js")) as { buildShareUrl: (b: string, p: Record<string, string | undefined>) => string; normalizeBase: (v: string) => string; safeHttpUrl: (v: string) => string; DEFAULT_BASE: string };

describe("browser extension", () => {
  it("builds share URLs: only http(s) URLs pass, lengths are capped, base must be https (http only for localhost)", () => {
    const u = new URL(share.buildShareUrl("https://app.sichttakt.de/irgendwas", { title: "Café  ", url: "https://shop.example.de/a?b=1", text: "x".repeat(5000), image: "javascript:alert(1)" }));
    expect(u.origin + u.pathname).toBe("https://app.sichttakt.de/app/share");
    expect(u.searchParams.get("title")).toBe("Café");
    expect(u.searchParams.get("url")).toBe("https://shop.example.de/a?b=1");
    expect(u.searchParams.get("text")).toHaveLength(3000);
    expect(u.searchParams.has("image")).toBe(false);
    expect(share.normalizeBase("http://evil.example")).toBe(share.DEFAULT_BASE);
    expect(share.normalizeBase("http://localhost:3610/app")).toBe("http://localhost:3610");
    expect(share.safeHttpUrl("chrome://settings")).toBe("");
  });

  it("background worker registers three context menus and opens the share page next to the tab", async () => {
    const created: { id: string; contexts: string[] }[] = [];
    const opened: { url: string; index?: number }[] = [];
    let installed: () => void = () => {};
    let clicked: (info: Record<string, unknown>, tab: Record<string, unknown>) => Promise<void> = async () => {};
    vi.stubGlobal("chrome", {
      runtime: { onInstalled: { addListener: (f: () => void) => (installed = f) } },
      contextMenus: { create: (m: { id: string; contexts: string[] }) => created.push(m), onClicked: { addListener: (f: typeof clicked) => (clicked = f) } },
      i18n: { getMessage: (k: string) => k },
      storage: { sync: { get: async () => ({ base: "http://localhost:3610" }) } },
      tabs: { create: async (o: { url: string; index?: number }) => void opened.push(o) },
    });
    // @ts-expect-error plain JS module
    await import("../extension/background.js");
    installed();
    expect(created.map((c) => c.id)).toEqual(["st-page", "st-image", "st-selection"]);
    await clicked({ menuItemId: "st-selection", selectionText: "Ein gutes Zitat", pageUrl: "https://blog.example.de/post" }, { title: "Blog", url: "https://blog.example.de/post", index: 4 });
    await clicked({ menuItemId: "st-image", srcUrl: "https://cdn.example.de/bild.jpg", pageUrl: "https://blog.example.de/post" }, { title: "Blog", index: 4 });
    const a = new URL(opened[0]!.url);
    expect(a.origin).toBe("http://localhost:3610");
    expect(a.searchParams.get("text")).toBe("Ein gutes Zitat");
    expect(opened[0]!.index).toBe(5);
    expect(new URL(opened[1]!.url).searchParams.get("image")).toBe("https://cdn.example.de/bild.jpg");
    vi.unstubAllGlobals();
  });

  it("manifest is MV3 with minimal permissions; every message key exists in de/en/tr; icons exist", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(["activeTab", "contextMenus", "storage"]);
    expect(manifest.host_permissions).toBeUndefined(); // no access to page contents or cookies
    for (const f of Object.values(manifest.icons) as string[]) expect(existsSync(path.join(root, f))).toBe(true);
    const used = new Set<string>();
    for (const f of readdirSync(root).filter((x) => /\.(js|html|json)$/.test(x))) {
      const src = readFileSync(path.join(root, f), "utf8");
      for (const m of src.matchAll(/getMessage\("(\w+)"\)|data-i18n="(\w+)"|__MSG_(\w+)__/g)) used.add(m[1] ?? m[2] ?? m[3]!);
    }
    expect(used.size).toBeGreaterThan(8);
    for (const loc of ["de", "en", "tr"]) {
      const msgs = JSON.parse(readFileSync(path.join(root, "_locales", loc, "messages.json"), "utf8"));
      for (const k of used) expect(msgs[k]?.message, `${loc}:${k}`).toBeTruthy();
    }
  });
});
