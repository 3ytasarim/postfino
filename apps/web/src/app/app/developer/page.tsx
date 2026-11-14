import { KeyRound, Webhook, Lock } from "lucide-react";
import { desc, eq, schema } from "@sichttakt/db";
import { getEntitlements, listApiKeys, listWebhooks, getUsage, authorize } from "@sichttakt/core";
import { API_SCOPES, WEBHOOK_EVENTS } from "@sichttakt/shared";
import { PageHeader, Empty, Notice } from "@/components/ui";
import { SecretForm } from "@/components/secret-forms";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import { createApiKeyAction, revokeApiKeyAction, rotateApiKeyAction, createWebhookAction, deleteWebhookAction } from "../actions";

export const metadata = { title: "API & Webhooks" };

export default async function DeveloperPage() {
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  authorize(ctx.actor, null, "apikeys.manage");
  const ent = await getEntitlements(ctx.svc.db, ctx.organization.id);
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  if (!ent.features.has("public_api")) {
    return (
      <>
        <PageHeader title={t.developer.title} subtitle={t.developer.subtitle} />
        <Empty icon={Lock} title={t.developer.planLocked}>
          <a href="/app/billing" className="btn btn-primary mt-2">
            {t.nav.billing}
          </a>
        </Empty>
      </>
    );
  }
  const [keys, hooks, usage, deliveries, logs] = await Promise.all([
    listApiKeys(ctx.svc.db, ctx.actor),
    listWebhooks(ctx.svc.db, ctx.actor),
    getUsage(ctx.svc.db, ctx.organization.id),
    ctx.svc.db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.organizationId, ctx.organization.id)).orderBy(desc(schema.webhookDeliveries.createdAt)).limit(10),
    ctx.svc.db
      .select({ id: schema.apiRequestLogs.id, method: schema.apiRequestLogs.method, path: schema.apiRequestLogs.path, status: schema.apiRequestLogs.status, errorCode: schema.apiRequestLogs.errorCode, durationMs: schema.apiRequestLogs.durationMs, requestId: schema.apiRequestLogs.requestId, createdAt: schema.apiRequestLogs.createdAt })
      .from(schema.apiRequestLogs)
      .where(eq(schema.apiRequestLogs.organizationId, ctx.organization.id))
      .orderBy(desc(schema.apiRequestLogs.createdAt))
      .limit(25),
  ]);
  const pct = usage.api_requests.limit ? Math.min(100, (usage.api_requests.used / usage.api_requests.limit) * 100) : 0;

  return (
    <>
      <PageHeader
        title={t.developer.title}
        subtitle={t.developer.subtitle}
        actions={
          <>
            <a href="/developers" className="btn btn-ghost" target="_blank" rel="noreferrer">
              {t.devPortal.portalLink}
            </a>
            <a href={`${ctx.svc.config.API_URL}/postman.json`} className="btn btn-ghost">
              {t.devPortal.postman}
            </a>
          </>
        }
      />
      <section className="card mb-6 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold">{t.developer.usage}</h2>
          <p className="font-display text-xl font-bold tabular-nums">
            {usage.api_requests.used.toLocaleString(intlLocale(locale))} <span className="text-sm text-ink-3">/ {usage.api_requests.limit.toLocaleString(intlLocale(locale))} {t.developer.requests}</span>
          </p>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${pct >= 80 ? "bg-bad" : "bg-takt"}`} style={{ width: `${pct}%` }} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <KeyRound className="size-5" /> {t.developer.keys}
          </h2>
          {keys.length === 0 ? (
            <Empty icon={KeyRound} title={t.common.none} />
          ) : (
            <ul className="divide-y divide-line">
              {keys.map((k) => (
                <li key={k.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{k.name}</span>
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{k.prefix}_…</code>
                    <span className={`chip ${k.environment === "test" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>{k.environment}</span>
                    {k.revokedAt && <span className="chip bg-bad-soft text-bad">{t.developer.revoked}</span>}
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    {k.scopes.join(", ")} · {t.developer.lastUsed}: {k.lastUsedAt ? df.format(k.lastUsedAt) : "—"}
                    {k.expiresAt ? ` · ⏱ ${df.format(k.expiresAt)}` : ""}
                  </p>
                  {!k.revokedAt && (
                    <div className="mt-2 flex gap-2">
                      <form action={revokeApiKeyAction}>
                        <input type="hidden" name="keyId" value={k.id} />
                        <button className="btn btn-danger !min-h-[34px] text-xs">{t.developer.revoke}</button>
                      </form>
                      <SecretForm action={rotateApiKeyAction} submit={t.developer.rotate} secretNote={t.developer.secretOnce} submitClassName="btn btn-ghost !min-h-[34px] text-xs">
                        <input type="hidden" name="keyId" value={k.id} />
                      </SecretForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <details className="mt-5 rounded-[14px] border border-line p-4">
            <summary className="cursor-pointer font-semibold">{t.developer.newKey}</summary>
            <SecretForm action={createApiKeyAction} submit={t.common.create} secretNote={t.developer.secretOnce} className="mt-4 space-y-4">
              <div>
                <label className="label" htmlFor="kname">
                  {t.developer.keyName}
                </label>
                <input id="kname" name="name" className="input" placeholder="z. B. Shop-Backend" required />
              </div>
              <fieldset>
                <legend className="label">{t.developer.scopes}</legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {API_SCOPES.map((s) => (
                    <label key={s} className="flex items-center gap-2 font-mono text-xs">
                      <input type="checkbox" name="scopes" value={s} defaultChecked={["posts:read", "posts:write", "media:write", "accounts:read"].includes(s)} className="accent-[var(--takt)]" /> {s}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="label">{t.nav.workspace}</legend>
                {ctx.workspaces.map((w) => (
                  <label key={w.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="workspaceIds" value={w.id} defaultChecked={w.id === ctx.workspace.id} className="accent-[var(--takt)]" /> {w.name}
                  </label>
                ))}
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="kenv">
                    {t.developer.environment}
                  </label>
                  <select id="kenv" name="environment" className="input">
                    <option value="live">{t.developer.live}</option>
                    <option value="test">{t.developer.test}</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="kexp">
                    {t.developer.expires}
                  </label>
                  <input id="kexp" name="expires" type="date" className="input" />
                </div>
              </div>
            </SecretForm>
          </details>
        </section>

        <section className="card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <Webhook className="size-5" /> {t.developer.webhooks}
          </h2>
          {hooks.length === 0 ? (
            <Empty icon={Webhook} title={t.common.none} />
          ) : (
            <ul className="divide-y divide-line">
              {hooks.map((h) => (
                <li key={h.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{h.url}</p>
                    <p className="mt-1 text-xs text-ink-3">{h.events.join(", ")}</p>
                  </div>
                  <form action={deleteWebhookAction}>
                    <input type="hidden" name="webhookId" value={h.id} />
                    <button className="btn btn-danger !min-h-[34px] text-xs">{t.common.delete}</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-5 rounded-[14px] border border-line p-4">
            <summary className="cursor-pointer font-semibold">{t.developer.newWebhook}</summary>
            <SecretForm action={createWebhookAction} submit={t.common.create} secretNote={t.developer.secretWebhook} className="mt-4 space-y-4">
              <div>
                <label className="label" htmlFor="wurl">
                  {t.developer.url}
                </label>
                <input id="wurl" name="url" type="url" className="input" placeholder="https://cms.example.de/webhooks/sichttakt" required />
              </div>
              <fieldset>
                <legend className="label">{t.developer.events}</legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {WEBHOOK_EVENTS.map((e) => (
                    <label key={e} className="flex items-center gap-2 font-mono text-xs">
                      <input type="checkbox" name="events" value={e} defaultChecked={e.startsWith("post.")} className="accent-[var(--takt)]" /> {e}
                    </label>
                  ))}
                </div>
              </fieldset>
            </SecretForm>
          </details>
          {deliveries.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-bold">Zustellungen</h3>
              <ul className="space-y-1 text-xs">
                {deliveries.map((d) => (
                  <li key={d.id} className="flex justify-between gap-2">
                    <span className="font-mono">{d.event}</span>
                    <span className={d.status === "delivered" ? "text-ok" : "text-warn"}>
                      {d.status} {d.lastStatusCode ?? ""} · {d.attempts}×
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
      <section className="card mt-6 overflow-x-auto p-6">
        <h2 className="mb-4 text-lg font-bold">{t.devPortal.requestLog}</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-ink-3">{t.devPortal.noLogs}</p>
        ) : (
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b border-line text-left text-xs text-ink-3">
              <tr>
                <th className="py-2 pr-3 font-semibold">{t.devPortal.time}</th>
                <th className="py-2 pr-3 font-semibold">{t.devPortal.method}</th>
                <th className="py-2 pr-3 font-semibold">{t.devPortal.path}</th>
                <th className="py-2 pr-3 font-semibold">{t.devPortal.code}</th>
                <th className="py-2 pr-3 text-right font-semibold">{t.devPortal.duration}</th>
                <th className="py-2 font-semibold">Request-ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3 whitespace-nowrap text-ink-3">{df.format(l.createdAt)}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{l.method}</td>
                  <td className="max-w-[280px] truncate py-2 pr-3 font-mono text-xs" title={l.path}>
                    {l.path}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`chip ${l.status < 300 ? "bg-ok-soft text-ok" : l.status < 500 ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"}`}>
                      {l.status}
                      {l.errorCode ? ` · ${l.errorCode}` : ""}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-3">{l.durationMs} ms</td>
                  <td className="py-2 font-mono text-[0.7rem] text-ink-3">{l.requestId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="mt-6">
        <Notice tone="info">API-Schlüssel nur serverseitig verwenden (Authorization: Bearer). Schreibende Anfragen benötigen einen Idempotency-Key-Header. Webhooks sind mit HMAC-SHA256 signiert (SichtTakt-Signature).</Notice>
      </div>
    </>
  );
}
