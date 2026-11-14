"use client";
import Link from "next/link";
import { useActionState, useOptimistic, useRef, useState, useTransition } from "react";
import { wallClockToUtc, NonexistentLocalTimeError } from "@sichttakt/shared";
import type { Messages } from "@/i18n/de";
import { reschedulePostAction, bulkShiftAction } from "@/app/app/actions";

export type CalPost = { id: string; day: string; time: string; caption: string; type: string; status: string; statusLabel: string; channels: string[]; movable: boolean };

const tone: Record<string, string> = {
  SCHEDULED: "border-l-takt",
  PENDING_APPROVAL: "border-l-puls",
  PUBLISHED: "border-l-ok",
  FAILED_FINAL: "border-l-bad",
  FAILED_RETRYABLE: "border-l-warn",
};

function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function CalendarBoard({
  view,
  start,
  days,
  today,
  month,
  timezone,
  posts,
  drafts,
  locale,
  t,
}: {
  view: "week" | "month" | "list";
  start: string;
  days: number;
  today: string;
  month: string;
  timezone: string;
  posts: CalPost[];
  drafts: { id: string; caption: string; type: string }[];
  locale: string;
  t: Messages["calendar"];
}) {
  const [items, moveLocal] = useOptimistic(posts, (cur, m: { id: string; day: string }) => cur.map((p) => (p.id === m.id ? { ...p, day: m.day } : p)));
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [, start_] = useTransition();
  // Some browsers / automation expose an empty DataTransfer on drop; keep the dragged id locally as well.
  const dragging = useRef<string | null>(null);
  const keys = Array.from({ length: days }, (_, i) => addDays(start, i));
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", timeZone: "UTC" });

  function drop(dayKey: string, postId: string) {
    const p = items.find((x) => x.id === postId);
    if (!p || !p.movable || p.day === dayKey) return;
    const [y, m, d] = dayKey.split("-").map(Number);
    const [hh, mm] = p.time.split(":").map(Number);
    let iso: string;
    try {
      iso = wallClockToUtc({ year: y!, month: m!, day: d!, hour: hh!, minute: mm! }, timezone).toISOString();
    } catch (e) {
      setError(e instanceof NonexistentLocalTimeError ? e.message : String(e));
      return;
    }
    start_(async () => {
      moveLocal({ id: postId, day: dayKey });
      const r = await reschedulePostAction(postId, iso);
      setError(r?.error ?? null);
    });
  }

  const card = (p: CalPost) => (
    <Link
      key={p.id}
      href={`/app/posts/${p.id}`}
      draggable={p.movable}
      onDragStart={(e) => {
        dragging.current = p.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", p.id);
      }}
      onDragEnd={() => (dragging.current = null)}
      className={`block rounded-[10px] border border-line border-l-[3px] bg-surface p-2 text-xs shadow-sm transition hover:shadow-md ${tone[p.status] ?? "border-l-line"} ${p.movable ? "cursor-grab active:cursor-grabbing" : "opacity-80"}`}
      title={`${p.statusLabel} · ${p.channels.join(", ")}`}
    >
      <span className="flex items-center justify-between gap-1 font-semibold tabular-nums">
        {p.time}
        <span className="rounded bg-surface-2 px-1 text-[0.6rem] uppercase text-ink-3">{p.type}</span>
      </span>
      <span className="mt-0.5 line-clamp-2 text-ink-2">{p.caption || "—"}</span>
    </Link>
  );

  const cell = (key: string, compact: boolean) => {
    const list = items.filter((p) => p.day === key).sort((a, b) => a.time.localeCompare(b.time));
    const inMonth = view !== "month" || key.startsWith(month);
    return (
      <div
        key={key}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(key);
        }}
        onDragLeave={() => setOver((o) => (o === key ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          setOver(null);
          drop(key, e.dataTransfer.getData("text/plain") || dragging.current || "");
          dragging.current = null;
        }}
        className={`flex min-h-[110px] flex-col gap-1.5 rounded-[12px] border p-2 transition-colors ${over === key ? "border-takt bg-takt-soft/40" : "border-line bg-bg"} ${inMonth ? "" : "opacity-45"} ${compact ? "" : "min-h-[340px]"}`}
        aria-label={key}
      >
        <p className={`text-xs font-semibold ${key === today ? "text-takt" : "text-ink-3"}`}>{dayFmt.format(new Date(`${key}T00:00:00Z`))}</p>
        {list.map(card)}
      </div>
    );
  };

  if (view === "list") return <ListView items={items} t={t} />;

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded-[12px] bg-bad-soft px-3 py-2 text-sm font-medium text-bad">
          {error}
        </p>
      )}
      <div className="overflow-x-auto pb-2">
        <div className={`grid min-w-[760px] grid-cols-7 gap-2`}>{keys.map((k) => cell(k, view === "month"))}</div>
      </div>
      {drafts.length > 0 && (
        <details className="mt-6 rounded-[14px] border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            {t.unscheduled} ({drafts.length})
          </summary>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link href={`/app/posts/${d.id}`} className="block truncate rounded-[10px] border border-line px-3 py-2 text-sm hover:bg-surface-2">
                  <span className="mr-2 text-[0.65rem] uppercase text-ink-3">{d.type}</span>
                  {d.caption || "—"}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ListView({ items, t }: { items: CalPost[]; t: Messages["calendar"] }) {
  const [state, action, pending] = useActionState(bulkShiftAction, undefined);
  const sorted = [...items].sort((a, b) => `${a.day}${a.time}`.localeCompare(`${b.day}${b.time}`));
  if (sorted.length === 0) return <p className="rounded-[14px] border border-dashed border-line p-10 text-center text-ink-3">{t.noPosts}</p>;
  return (
    <form action={action} className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <tbody className="divide-y divide-line">
          {sorted.map((p) => (
            <tr key={p.id}>
              <td className="w-10 px-4 py-2.5">
                <input type="checkbox" name="postIds" value={p.id} disabled={!p.movable} aria-label={p.caption || p.id} className="size-4 accent-[var(--takt)]" />
              </td>
              <td className="px-2 py-2.5 whitespace-nowrap font-semibold tabular-nums">
                {p.day} {p.time}
              </td>
              <td className="max-w-[360px] truncate px-2 py-2.5 text-ink-2">
                <Link href={`/app/posts/${p.id}`} className="hover:text-takt">
                  {p.caption || "—"}
                </Link>
              </td>
              <td className="px-2 py-2.5 text-xs text-ink-3">{p.channels.join(", ")}</td>
              <td className="px-4 py-2.5 text-xs">{p.statusLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
        <p className="w-full text-sm font-semibold sm:w-auto">{t.shift}</p>
        <label className="text-xs text-ink-2">
          {t.days}
          <input name="days" type="number" defaultValue={1} min={-30} max={30} className="input !min-h-[38px] !w-24" />
        </label>
        <label className="text-xs text-ink-2">
          {t.hours}
          <input name="hours" type="number" defaultValue={0} min={-23} max={23} className="input !min-h-[38px] !w-24" />
        </label>
        <button className="btn btn-primary !min-h-[38px]" disabled={pending}>
          {t.apply}
        </button>
        {state?.error && <p className="text-sm font-medium text-bad">{state.error}</p>}
        {state?.ok && <p className="text-sm font-medium text-ok">{t.moved}</p>}
      </div>
    </form>
  );
}
