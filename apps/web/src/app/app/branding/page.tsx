import { Lock, CheckCircle2 } from "lucide-react";
import { getBranding, getEntitlements, listMedia, authorize } from "@sichttakt/core";
import { PageHeader, Empty, Notice } from "@/components/ui";
import { FormAction } from "@/components/form-action";
import { getMessages } from "@/i18n";
import { requireContext } from "@/lib/server";
import { brandingAction, domainAction, verifyDomainAction } from "../actions-billing";

export const metadata = { title: "White-Label" };

export default async function BrandingPage() {
  const ctx = await requireContext();
  const { t } = await getMessages();
  const s = t.brandingPage;
  authorize(ctx.actor, null, "org.manage");
  const ent = await getEntitlements(ctx.svc.db, ctx.organization.id);
  if (!ent.features.has("white_label")) {
    return (
      <>
        <PageHeader title={s.title} subtitle={s.subtitle} />
        <Empty icon={Lock} title={s.locked}>
          <a href="/app/billing" className="btn btn-primary mt-2">
            {t.nav.billing}
          </a>
        </Empty>
      </>
    );
  }
  const [b, media] = await Promise.all([getBranding(ctx.svc.db, ctx.actor), listMedia(ctx.svc.db, ctx.actor, ctx.workspace.id)]);
  const images = media.filter((m) => m.kind === "image" && m.status === "ready");
  const accent = b.accentColor ?? "#0047ab";
  return (
    <>
      <PageHeader title={s.title} subtitle={s.subtitle} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="card p-6">
            <FormAction action={brandingAction} submit={t.common.save} className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm sm:col-span-2">
                {s.appName}
                <input name="appName" defaultValue={b.appName ?? ""} maxLength={40} className="input mt-1" placeholder={ctx.organization.name} />
              </label>
              <label className="text-sm">
                {s.logo}
                <select name="logoAssetId" defaultValue={b.logoAssetId ?? ""} className="input mt-1">
                  <option value="">{s.noLogo}</option>
                  {images.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.originalFilename ?? m.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                {s.color}
                <input name="accentColor" type="color" defaultValue={accent} className="input mt-1 !h-12 !p-1" />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="hidePoweredBy" defaultChecked={b.hidePoweredBy} className="size-4 accent-[var(--takt)]" /> {s.hidePowered}
              </label>
            </FormAction>
          </section>

          <section className="card p-6">
            <h2 className="mb-1 text-lg font-bold">{s.domain}</h2>
            {b.customDomain && (
              <p className="mb-4 flex items-center gap-2 text-sm">
                <code className="font-mono">{b.customDomain}</code>
                {b.domainVerifiedAt ? (
                  <span className="chip bg-ok-soft text-ok">
                    <CheckCircle2 className="size-3.5" /> {s.verified}
                  </span>
                ) : (
                  <span className="chip bg-warn-soft text-warn">{s.notVerified}</span>
                )}
              </p>
            )}
            <FormAction action={domainAction} submit={s.setDomain} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <input name="domain" defaultValue={b.customDomain ?? ""} placeholder={s.domainHint} aria-label={s.domain} className="input flex-1" required />
            </FormAction>
            {b.customDomain && !b.domainVerifiedAt && (
              <div className="mt-5 space-y-3">
                <p className="text-sm">{s.dnsHint}</p>
                <pre className="overflow-x-auto rounded-[12px] bg-surface-2 p-3 font-mono text-xs">{`_sichttakt.${b.customDomain}  TXT  "${b.domainToken}"`}</pre>
                <FormAction action={verifyDomainAction} submit={s.verify} submitClassName="btn btn-ghost">
                  <span />
                </FormAction>
              </div>
            )}
            {b.customDomain && (
              <FormAction action={domainAction} submit={s.removeDomain} submitClassName="btn btn-ghost !min-h-[36px] mt-3 text-xs">
                <input type="hidden" name="remove" value="1" />
              </FormAction>
            )}
            <div className="mt-4">
              <Notice tone="info">{s.routingNote}</Notice>
            </div>
          </section>
        </div>

        <aside>
          <p className="eyebrow mb-2">{s.preview}</p>
          <div className="card overflow-hidden">
            <div className="flex h-14 items-center gap-3 border-b border-line px-4">
              {b.logoAssetId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/app/api/media/${b.logoAssetId}`} alt="" className="h-8 w-auto" />
              ) : (
                <span className="grid size-8 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: accent }}>
                  {(b.appName ?? ctx.organization.name).slice(0, 1)}
                </span>
              )}
              <span className="font-semibold">{b.appName ?? ctx.organization.name}</span>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <p className="text-ink-2">{t.review.title}</p>
              <span className="inline-flex min-h-[40px] items-center rounded-[10px] px-4 font-semibold text-white" style={{ background: accent }}>
                {t.review.approve}
              </span>
              {!b.hidePoweredBy && <p className="text-xs text-ink-3">Postfino — {t.brand.by}</p>}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
