import { listIntegrations, authorize } from "@sichttakt/core";
import { PageHeader } from "@/components/ui";
import { FormAction } from "@/components/form-action";
import { UnsplashSearch } from "@/components/unsplash-search";
import { getMessages } from "@/i18n";
import { requireContext } from "@/lib/server";
import { connectBitlyAction, disconnectIntegrationAction } from "../actions-links";
import { PasswordInput } from "@/components/password-input";

export const metadata = { title: "Integrationen" };

const TONE = { available: "bg-ok-soft text-ok", connected: "bg-ok-soft text-ok", not_connected: "bg-surface-2 text-ink-2", not_configured: "bg-warn-soft text-warn", plan_locked: "bg-surface-2 text-ink-3" } as const;

export default async function IntegrationsPage() {
  const ctx = await requireContext();
  const { t } = await getMessages();
  const it = t.integrationsPage;
  const list = await listIntegrations(ctx.svc.db, ctx.svc.config, ctx.actor);
  let canManage = true;
  try {
    authorize(ctx.actor, null, "org.manage");
  } catch {
    canManage = false;
  }
  const cats = ["media", "links", "automation", "content"] as const;
  const unsplash = list.find((i) => i.id === "unsplash");
  return (
    <>
      <PageHeader title={it.title} subtitle={it.subtitle} />
      <div className="space-y-8">
        {cats.map((c) => (
          <section key={c}>
            <h2 className="eyebrow mb-3">{it[`cat_${c}`]}</h2>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list
                .filter((i) => i.category === c)
                .map((i) => (
                  <li key={i.id} className="card flex flex-col p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold">{i.name}</h3>
                      <span className={`chip ${TONE[i.status]}`}>{it[i.status]}</span>
                    </div>
                    <p className="mt-2 flex-1 text-sm text-ink-2">{(it.how as Record<string, string>)[i.id] ?? i.how}</p>
                    {i.id === "bitly" && canManage && (
                      <div className="mt-4">
                        {i.status === "connected" ? (
                          <form action={disconnectIntegrationAction}>
                            <input type="hidden" name="provider" value="bitly" />
                            <button className="btn btn-ghost !min-h-[36px] text-xs">{it.disconnect}</button>
                          </form>
                        ) : (
                          <FormAction action={connectBitlyAction} submit={it.connect} className="space-y-2" submitClassName="btn btn-primary !min-h-[36px] text-xs">
                            <PasswordInput name="token" autoComplete="off" placeholder={it.bitlyToken} aria-label={it.bitlyToken} required showLabel={t.auth.showPassword} hideLabel={t.auth.hidePassword} />
                            <p className="text-xs text-ink-3">{it.bitlyHelp}</p>
                          </FormAction>
                        )}
                      </div>
                    )}
                    {i.id === "shortlinks" && (
                      <a href="/app/links" className="btn btn-ghost mt-4 !min-h-[36px] self-start text-xs">
                        {t.nav.links}
                      </a>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <section className="card p-6">
          <h2 className="mb-4 text-lg font-bold">{it.unsplash}</h2>
          {unsplash?.status === "available" ? <UnsplashSearch t={it} /> : <p className="text-sm text-warn">{it.unsplashOff}</p>}
        </section>
      </div>
    </>
  );
}
