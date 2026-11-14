import path from "node:path";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { Download, FileCode2, KeyRound, Repeat, Gauge, ShieldCheck, AlertOctagon } from "lucide-react";
import { getMessages } from "@/i18n";
import { services } from "@/lib/server";
import { findRoot } from "@/lib/paths";

export const metadata = {
  title: "Entwicklerportal",
  description: "Postfino Public API v1: REST, Bearer-API-Key, Idempotenz, signierte Webhooks, OpenAPI 3.1, Postman Collection, TypeScript- und PHP-SDK.",
  robots: { index: true, follow: true },
};

type Op = { summary?: string; tags?: string[]; "x-scope"?: string };
type Spec = { info: { version: string }; paths: Record<string, Record<string, Op>> };

const METHOD = { get: "bg-puls-soft text-puls", post: "bg-ok-soft text-ok", patch: "bg-warn-soft text-warn", put: "bg-warn-soft text-warn", delete: "bg-bad-soft text-bad" } as Record<string, string>;

export default async function DevelopersPage() {
  const { t } = await getMessages();
  const d = t.devPortal;
  const api = services().config.API_URL.replace(/\/$/, "");
  const spec = parseYaml(await readFile(path.join(findRoot(), "docs", "API_OPENAPI.yaml"), "utf8")) as Spec;
  const groups = new Map<string, { method: string; path: string; op: Op }[]>();
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!METHOD[method]) continue;
      const tag = op.tags?.[0] ?? "General";
      groups.set(tag, [...(groups.get(tag) ?? []), { method, path: p, op }]);
    }
  }
  const code = (s: string) => <pre className="mt-2 overflow-x-auto rounded-[12px] bg-ink p-4 font-mono text-[0.8rem] leading-relaxed text-bg">{s}</pre>;
  const card = (Icon: typeof KeyRound, title: string, body: string) => (
    <div className="card p-5">
      <h3 className="flex items-center gap-2 font-bold">
        <Icon className="size-4 text-takt" aria-hidden /> {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
    </div>
  );

  return (
    <article>
      <header className="max-w-3xl">
        <p className="eyebrow">Public API v{spec.info.version}</p>
        <h1 className="mt-2 text-[clamp(2rem,4vw,3rem)] font-bold leading-tight">{d.title}</h1>
        <p className="mt-3 text-lg text-ink-2">{d.subtitle}</p>
      </header>

      <section className="mt-10 grid gap-4 md:grid-cols-3" aria-label={d.downloads}>
        <a href={`${api}/postman.json`} className="card flex items-center gap-3 p-5 transition-colors hover:border-ink-3">
          <Download className="size-5 text-takt" aria-hidden />
          <span className="font-semibold">{d.postman}</span>
        </a>
        <a href={`${api}/api/v1/openapi.yaml`} className="card flex items-center gap-3 p-5 transition-colors hover:border-ink-3">
          <FileCode2 className="size-5 text-takt" aria-hidden />
          <span className="font-semibold">{d.openapi}</span>
        </a>
        <div className="card p-5">
          <p className="font-semibold">{d.sdks}</p>
          <p className="mt-1 flex flex-wrap gap-3 text-sm">
            <a href="/developers/sdk/sichttakt.ts" className="text-takt underline underline-offset-2">
              {d.sdkTs}
            </a>
            <a href="/developers/sdk/SichtTakt.php" className="text-takt underline underline-offset-2">
              {d.sdkPhp}
            </a>
          </p>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold">{d.quickstart}</h2>
        <ol className="mt-4 space-y-5">
          <li>
            <p className="font-medium">1. {d.step1}</p>
          </li>
          <li>
            <p className="font-medium">2. {d.step2}</p>
            {code(`curl ${api}/api/v1/accounts \\\n  -H "Authorization: Bearer $SICHTTAKT_API_KEY"`)}
          </li>
          <li>
            <p className="font-medium">3. {d.step3}</p>
            {code(
              `curl -X POST ${api}/api/v1/posts \\\n  -H "Authorization: Bearer $SICHTTAKT_API_KEY" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d '{"workspace_id":"…","account_ids":["…"],"type":"image","caption":"Herbst-Kollektion ist da","media_asset_ids":["…"],"scheduled_at":"2026-11-12T10:00:00+01:00","status":"scheduled"}'`,
            )}
          </li>
        </ol>
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-2">
        {card(KeyRound, d.auth, d.authBody)}
        {card(Repeat, d.idem, d.idemBody)}
        {card(Gauge, d.limits, d.limitsBody)}
        {card(ShieldCheck, d.webhooks, d.webhooksBody)}
      </section>

      <section className="mt-6">
        <div className="card p-5">
          <h3 className="flex items-center gap-2 font-bold">
            <AlertOctagon className="size-4 text-takt" aria-hidden /> {d.errors}
          </h3>
          {code(`{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": [ … ], "request_id": "req_…" } }`)}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold">{d.endpoints}</h2>
        <div className="mt-4 space-y-6">
          {[...groups.entries()].map(([tag, ops]) => (
            <div key={tag}>
              <h3 className="eyebrow mb-2">{tag}</h3>
              <ul className="card divide-y divide-line">
                {ops.map((o) => (
                  <li key={o.method + o.path} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                    <span className="flex items-center gap-3">
                      <span className={`chip w-16 justify-center font-mono text-[0.7rem] uppercase ${METHOD[o.method]}`}>{o.method}</span>
                      <code className="font-mono text-[0.82rem]">{o.path}</code>
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-ink-2 sm:truncate">{o.op.summary}</span>
                    {o.op["x-scope"] && (
                      <span className="text-xs text-ink-3">
                        {d.scope}: <code className="font-mono">{o.op["x-scope"]}</code>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
