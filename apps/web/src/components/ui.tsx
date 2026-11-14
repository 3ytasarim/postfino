import type { LucideIcon } from "lucide-react";

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between rise">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-[clamp(1.7rem,2.6vw,2.3rem)] font-bold leading-tight">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-line px-6 py-14 text-center">
      <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-surface-2 text-ink-3">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-3 text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "ok" | "info"; children: React.ReactNode }) {
  const cls = { warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", ok: "bg-ok-soft text-ok", info: "bg-puls-soft text-puls" }[tone];
  return (
    <div role="status" className={`rounded-[14px] px-4 py-3 text-sm font-medium ${cls}`}>
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "takt" | "puls" | "bad" | "ok" }) {
  const dot = { takt: "bg-takt", puls: "bg-puls", bad: "bg-bad", ok: "bg-ok" }[tone ?? "takt"];
  return (
    <div className="card p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-2">
        <span className={`size-2 rounded-full ${dot}`} aria-hidden />
        {label}
      </p>
      <p className="mt-3 font-display text-4xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

export function PlatformBadge({ platform, sandbox }: { platform: string; sandbox?: boolean }) {
  const name: Record<string, string> = { instagram_business: "Instagram", facebook_page: "Facebook", sandbox: "Sandbox", linkedin_profile: "LinkedIn", linkedin_page: "LinkedIn Seite", tiktok: "TikTok", youtube: "YouTube", google_business: "Google Business", x: "X", threads: "Threads", pinterest: "Pinterest", bluesky: "Bluesky", mastodon: "Mastodon" };
  return (
    <span className={`chip ${sandbox ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"}`}>
      {name[platform] ?? platform}
      {sandbox && " · MOCK"}
    </span>
  );
}
