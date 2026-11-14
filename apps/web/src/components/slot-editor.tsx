"use client";
import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { saveSlotsAction } from "@/app/app/actions";

type Slot = { weekday: number; minuteOfDay: number };
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function SlotEditor({ channelId, initial, weekdays, t }: { channelId: string; initial: Slot[]; weekdays: string[]; t: { add: string; save: string; remove: string } }) {
  const [slots, setSlots] = useState<Slot[]>(initial);
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [state, action, pending] = useActionState(saveSlotsAction, undefined);

  function add() {
    const [h, m] = time.split(":").map(Number);
    const minute = (h ?? 0) * 60 + (m ?? 0);
    setSlots((cur) => {
      const next = [...cur];
      for (const d of days) if (!next.some((s) => s.weekday === d && s.minuteOfDay === minute)) next.push({ weekday: d, minuteOfDay: minute });
      return next.sort((a, b) => a.weekday - b.weekday || a.minuteOfDay - b.minuteOfDay);
    });
  }

  return (
    <form action={action}>
      <input type="hidden" name="channelId" value={channelId} />
      {slots.map((s) => (
        <input key={`${s.weekday}@${s.minuteOfDay}`} type="hidden" name="slot" value={`${s.weekday}@${hm(s.minuteOfDay)}`} />
      ))}
      <div className="grid grid-cols-7 gap-1.5">
        {weekdays.map((wd, i) => (
          <div key={wd} className="min-w-0">
            <p className="mb-1.5 text-center text-xs font-bold text-ink-3">{wd}</p>
            <ul className="space-y-1">
              {slots
                .filter((s) => s.weekday === i + 1)
                .map((s) => (
                  <li key={s.minuteOfDay} className="group flex items-center justify-between gap-0.5 rounded-[8px] bg-takt-soft px-1.5 py-1 text-xs font-semibold tabular-nums text-takt">
                    {hm(s.minuteOfDay)}
                    <button type="button" onClick={() => setSlots((c) => c.filter((x) => x !== s))} aria-label={`${t.remove} ${wd} ${hm(s.minuteOfDay)}`} className="opacity-60 hover:opacity-100">
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-[14px] bg-surface-2 p-3">
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Tage</legend>
          {weekdays.map((wd, i) => (
            <label key={wd} className={`grid min-h-[36px] min-w-[40px] cursor-pointer place-items-center rounded-[8px] px-2 text-xs font-semibold ${days.includes(i + 1) ? "bg-ink text-bg" : "bg-surface text-ink-2"}`}>
              <input type="checkbox" className="sr-only" checked={days.includes(i + 1)} onChange={(e) => setDays((d) => (e.target.checked ? [...d, i + 1] : d.filter((x) => x !== i + 1)))} />
              {wd}
            </label>
          ))}
        </fieldset>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input !min-h-[36px] !w-28" aria-label="Uhrzeit" />
        <button type="button" onClick={add} className="btn btn-ghost !min-h-[36px] text-sm">
          <Plus className="size-4" /> {t.add}
        </button>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {t.save}
        </button>
        {state?.ok && <span className="text-sm font-medium text-ok">✓</span>}
        {state?.error && <span className="text-sm font-medium text-bad">{state.error}</span>}
      </div>
    </form>
  );
}
