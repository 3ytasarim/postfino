"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowLeft, ChevronRight, Info, Check, ExternalLink, RefreshCw, BellRing } from "lucide-react";
import { NetworkIcon } from "./network-icon";
import { Logo } from "./logo";
import { connectPlatformAction, connectBlueskyAction, connectSandboxAction, createManualChannelAction } from "@/app/app/actions";
import type { Messages } from "@/i18n/de";

type Mode = "oauth" | "bluesky" | "mastodon" | "manual" | "unavailable";
type Variant = { platform: string; label: string; mode: Mode; note?: string };
type Network = { id: string; icon: string; name: string; sub: string; variants: Variant[]; custom?: "instagram" };

/**
 * "Connect a new channel": network grid → account type → official sign-in of the network (OAuth),
 * app password (Bluesky), instance (Mastodon) or a reminder-only channel where no publishing API exists.
 */
export function ConnectChannelDialog({ open, onClose, configured, sandbox, l }: { open: boolean; onClose: () => void; configured: Record<string, boolean>; sandbox: boolean; l: Messages["connectUi"] }) {
  const [net, setNet] = useState<Network | null>(null);
  const [variant, setVariant] = useState<Variant | null>(null);
  const [igCheck, setIgCheck] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [bsky, bskyAction, bskyPending] = useActionState(connectBlueskyAction, undefined);
  const [manual, manualAction, manualPending] = useActionState(createManualChannelAction, undefined);

  useEffect(() => {
    if (!open) {
      setNet(null);
      setVariant(null);
      setIgCheck(false);
      return;
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);
  useEffect(() => {
    if (bsky?.ok || manual?.ok) onClose();
  }, [bsky, manual, onClose]);
  if (!open) return null;

  const v = (platform: string, label: string, mode: Mode = "oauth", note?: string): Variant =>
    mode === "manual" || mode === "unavailable" || configured[platform] ? { platform, label, mode, note } : { platform, label, mode: "unavailable", note: l.notReady };
  const NETWORKS: Network[] = [
    { id: "instagram", icon: "instagram_business", name: "Instagram", sub: l.subInstagram, custom: "instagram", variants: [v("instagram_business", l.igBusiness), v("instagram_personal", l.igPersonal, "manual", l.noApiPersonal)] },
    { id: "threads", icon: "threads", name: "Threads", sub: l.subProfile, variants: [v("threads", l.profile)] },
    { id: "linkedin", icon: "linkedin_page", name: "LinkedIn", sub: l.subLinkedIn, variants: [v("linkedin_page", l.page), v("linkedin_profile", l.profile)] },
    { id: "facebook", icon: "facebook_page", name: "Facebook", sub: l.subFacebook, variants: [v("facebook_page", l.page), v("facebook_group", l.group, "manual", l.noApiGroups)] },
    { id: "bluesky", icon: "bluesky", name: "Bluesky", sub: l.subProfile, variants: [v("bluesky", l.profile, "bluesky")] },
    { id: "substack", icon: "substack", name: "Substack", sub: l.subProfile, variants: [v("substack", l.profile, "manual", l.noApiSubstack)] },
    { id: "youtube", icon: "youtube", name: "YouTube", sub: l.subChannel, variants: [v("youtube", l.channel)] },
    { id: "tiktok", icon: "tiktok", name: "TikTok", sub: l.subTikTok, variants: [v("tiktok", l.businessOrPersonal)] },
    { id: "mastodon", icon: "mastodon", name: "Mastodon", sub: l.subProfile, variants: [v("mastodon", l.profile, "mastodon")] },
    { id: "pinterest", icon: "pinterest", name: "Pinterest", sub: l.subPinterest, variants: [v("pinterest", l.boards)] },
    { id: "x", icon: "x", name: "X", sub: l.subProfile, variants: [v("x", l.profile)] },
    { id: "google_business", icon: "google_business", name: "Google Business", sub: l.subGbp, variants: [v("google_business", l.locations)] },
  ];
  const pick = (n: Network) => {
    setNet(n);
    setVariant(!n.custom && n.variants.length === 1 ? n.variants[0]! : null);
  };
  const back = () => {
    if (igCheck) return setIgCheck(false);
    if (variant && net && (net.variants.length > 1 || net.custom)) return setVariant(null);
    setNet(null);
    setVariant(null);
  };

  const oauthForm = (platform: string, label: string, className = "btn btn-primary w-full") => (
    <form action={connectPlatformAction}>
      <input type="hidden" name="platform" value={platform} />
      <button className={className}>{label}</button>
    </form>
  );
  const ig = net?.custom === "instagram" ? net.variants : null;
  const igPro = ig?.[0];

  // portal to <body>: an animated (transformed) ancestor would otherwise become the containing block of `fixed`
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cc-title" className="flex max-h-[92dvh] w-full max-w-[880px] flex-col overflow-hidden rounded-[22px] bg-bg shadow-2xl outline-none">
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="w-10">
            {net && (
              <button className="btn btn-ghost !min-h-[38px] !px-2" onClick={back} aria-label={l.back}>
                <ArrowLeft className="size-4" />
              </button>
            )}
          </span>
          <div className="flex flex-1 items-center justify-center gap-2" aria-hidden={!net}>
            {net ? (
              <>
                <Logo size={22} />
                <span className="text-ink-3">⇄</span>
                <NetworkIcon platform={net.icon} badge size={24} className="!ring-0" />
              </>
            ) : (
              <h2 id="cc-title" className="text-lg font-bold">
                {l.title}
              </h2>
            )}
          </div>
          <button className="btn btn-ghost !min-h-[38px] w-10 !px-2" onClick={onClose} aria-label={l.close}>
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-6 sm:px-8 sm:pb-8">
          {/* 1 — network grid */}
          {!net && (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {NETWORKS.map((n) => (
                  <li key={n.id}>
                    <button onClick={() => pick(n)} className="group flex h-full w-full flex-col items-center gap-1.5 rounded-[18px] border border-line bg-surface px-3 py-6 text-center transition hover:-translate-y-0.5 hover:border-ink-3 hover:shadow-lg">
                      <NetworkIcon platform={n.icon} badge size={44} className="!ring-0 transition-transform group-hover:scale-105" />
                      <span className="mt-2 font-semibold">{n.name}</span>
                      <span className="text-sm text-ink-2">{n.sub}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {sandbox && (
                <form action={connectSandboxAction} className="mt-5 text-center">
                  <button className="btn btn-ghost text-sm">{l.sandbox}</button>
                </form>
              )}
            </>
          )}

          {/* 2a — Instagram: professional vs personal */}
          {ig && igPro && !variant && !igCheck && (
            <div>
              <h2 id="cc-title" className="text-center text-xl font-bold">
                {l.igQuestion}
              </h2>
              <p className="mt-1 text-center text-sm text-ink-2">{l.igQuestionSub}</p>
              <div className="mt-6 grid gap-4 md:grid-cols-[1.4fr_1fr]">
                <section className="rounded-[18px] border border-line bg-surface p-6">
                  <h3 className="text-lg font-semibold">{l.igBusiness}</h3>
                  <span className="chip mt-2 bg-ok-soft text-ok">
                    <RefreshCw className="size-3" /> {l.auto}
                  </span>
                  <ul className="mt-4 space-y-2 text-sm">
                    {[l.fAuto, l.fNotify, l.fCommunity, l.fMetrics].map((f) => (
                      <li key={f} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> {f}
                      </li>
                    ))}
                  </ul>
                  {igPro.mode === "unavailable" ? (
                    <p className="mt-5 flex gap-2 rounded-[12px] bg-surface-2 p-3 text-sm text-ink-2">
                      <Info className="mt-0.5 size-4 shrink-0" /> {igPro.note}
                    </p>
                  ) : (
                    <button className="btn btn-primary mt-5 w-full" onClick={() => setIgCheck(true)}>
                      {l.connectInstagram}
                    </button>
                  )}
                  <p className="mt-4 flex gap-2 border-t border-line pt-4 text-xs text-ink-2">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {l.proHint}
                  </p>
                </section>
                <section className="rounded-[18px] border border-line bg-surface p-6">
                  <h3 className="text-lg font-semibold">{l.igPersonal}</h3>
                  <span className="chip mt-2 bg-surface-2 text-ink-2">
                    <BellRing className="size-3" /> {l.notifyOnly}
                  </span>
                  <p className="mt-4 flex gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> {l.fNotify}
                  </p>
                  <button className="btn btn-ghost mt-5 w-full" onClick={() => setVariant(ig[1]!)}>
                    {l.setupPersonal}
                  </button>
                </section>
              </div>
              <p className="mt-5 flex items-start justify-center gap-2 text-center text-xs text-ink-3">
                <NetworkIcon platform="facebook_page" badge size={16} className="!ring-0" /> {l.fbLinkHint}
              </p>
            </div>
          )}

          {/* 2b — Instagram: account check before OAuth */}
          {ig && igPro && igCheck && (
            <div className="mx-auto max-w-lg text-center">
              <h2 id="cc-title" className="text-xl font-bold">
                {l.checkTitle}
              </h2>
              <p className="mt-1 text-sm text-ink-2">{l.checkSub}</p>
              <ol className="mt-6 space-y-4 rounded-[18px] border border-line bg-surface p-6 text-left text-sm">
                <li className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ok-soft text-xs font-bold text-ok">1</span>
                  <span className="flex-1">
                    {l.check1}
                    <a href="https://www.instagram.com/accounts/login/" target="_blank" rel="noreferrer" className="btn btn-ghost mt-2 !min-h-[36px] w-fit text-xs">
                      <ExternalLink className="size-3.5" /> {l.openInstagram}
                    </a>
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ok-soft text-xs font-bold text-ok">2</span> {l.check2}
                </li>
                <li className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ok-soft text-xs font-bold text-ok">3</span> {l.check3}
                </li>
              </ol>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {oauthForm(igPro.platform, l.connectInstagram)}
                {oauthForm(igPro.platform, l.skipCheck, "btn btn-ghost w-full")}
              </div>
            </div>
          )}

          {/* 2c — account type for other networks */}
          {net && !net.custom && !variant && (
            <div className="mx-auto max-w-md">
              <h2 id="cc-title" className="mb-5 text-center text-xl font-bold">
                {net.name} {l.connectSuffix}
              </h2>
              <ul className="space-y-3">
                {net.variants.map((x) => (
                  <li key={x.platform}>
                    <button onClick={() => setVariant(x)} className="flex w-full items-center gap-4 rounded-[16px] border border-line bg-surface p-4 text-left hover:border-ink-3">
                      <NetworkIcon platform={net.icon} badge size={36} className="!ring-0" />
                      <span className="flex-1">
                        <span className="block font-semibold">{x.label}</span>
                        {x.mode === "manual" && <span className="block text-xs text-ink-3">{l.notifyOnly}</span>}
                        {x.mode === "unavailable" && <span className="block text-xs text-ink-3">{x.note}</span>}
                      </span>
                      <ChevronRight className="size-4 text-ink-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 3 — the actual connection step */}
          {net && variant && (
            <div className="mx-auto max-w-md text-center">
              <NetworkIcon platform={net.icon} badge size={56} className="!ring-0" />
              <h2 id="cc-title" className="mt-3 text-xl font-bold">
                {net.name} · {variant.label}
              </h2>
              {variant.mode === "unavailable" && (
                <p className="mt-5 flex items-start gap-2 rounded-[14px] bg-surface-2 p-4 text-left text-sm text-ink-2">
                  <Info className="mt-0.5 size-4 shrink-0" /> {variant.note}
                </p>
              )}
              {variant.mode === "oauth" && (
                <div className="mt-5">
                  <p className="mb-4 text-sm text-ink-2">{l.oauthHint}</p>
                  {oauthForm(variant.platform, l.continueTo.replace("{name}", net.name))}
                </div>
              )}
              {variant.mode === "mastodon" && (
                <form action={connectPlatformAction} className="mt-5 space-y-3 text-left">
                  <input type="hidden" name="platform" value="mastodon" />
                  <label className="label" htmlFor="cc-instance">
                    {l.instance}
                  </label>
                  <input id="cc-instance" name="instance" className="input" placeholder="mastodon.social" required autoFocus />
                  <p className="text-xs text-ink-3">{l.instanceHint}</p>
                  <button className="btn btn-primary w-full">{l.continueTo.replace("{name}", "Mastodon")}</button>
                </form>
              )}
              {variant.mode === "bluesky" && (
                <form action={bskyAction} className="mt-5 space-y-3 text-left">
                  <label className="label" htmlFor="cc-handle">
                    {l.handle}
                  </label>
                  <input id="cc-handle" name="identifier" className="input" placeholder="marke.bsky.social" autoComplete="off" required autoFocus />
                  <label className="label" htmlFor="cc-pw">
                    {l.appPassword}
                  </label>
                  <input id="cc-pw" name="password" type="password" className="input" placeholder="xxxx-xxxx-xxxx-xxxx" autoComplete="off" required pattern="[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}" />
                  <p className="text-xs text-ink-3">{l.appPasswordHint}</p>
                  {bsky?.error && (
                    <p role="alert" className="text-sm font-medium text-bad">
                      {bsky.error}
                    </p>
                  )}
                  <button className="btn btn-primary w-full" disabled={bskyPending}>
                    {bskyPending ? "…" : l.connect}
                  </button>
                </form>
              )}
              {variant.mode === "manual" && (
                <form action={manualAction} className="mt-5 space-y-3 text-left">
                  <p className="flex gap-2 rounded-[14px] bg-surface-2 p-4 text-sm text-ink-2">
                    <BellRing className="mt-0.5 size-4 shrink-0" /> {variant.note} {l.manualHint}
                  </p>
                  <input type="hidden" name="platform" value={variant.platform} />
                  <label className="label" htmlFor="cc-name">
                    {l.displayName}
                  </label>
                  <input id="cc-name" name="displayName" className="input" required maxLength={80} autoFocus />
                  <label className="label" htmlFor="cc-user">
                    {l.username}
                  </label>
                  <input id="cc-user" name="username" className="input" maxLength={80} placeholder="@" />
                  {manual?.error && (
                    <p role="alert" className="text-sm font-medium text-bad">
                      {manual.error}
                    </p>
                  )}
                  <button className="btn btn-primary w-full" disabled={manualPending}>
                    {manualPending ? "…" : l.create}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
