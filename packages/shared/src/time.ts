// Timezone helpers without external deps. Rule: persist UTC instants, store the channel's IANA zone
// next to them, convert wall-clock <-> instant only through these functions (DST-safe).

/** Offset (minutes, east positive) of `timeZone` at the given instant. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

export class NonexistentLocalTimeError extends Error {
  constructor(wall: WallClock, timeZone: string) {
    super(`Local time ${formatWall(wall)} does not exist in ${timeZone} (DST gap)`);
    this.name = "NonexistentLocalTimeError";
  }
}

const formatWall = (w: WallClock) =>
  `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")} ${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;

/**
 * Convert a local wall-clock time in `timeZone` to a UTC instant.
 * - Spring-forward gap (e.g. 02:30 on the last Sunday of March in Berlin): throws, the UI must ask the user.
 * - Fall-back overlap (02:30 occurs twice): picks the earlier (summer-time) occurrence unless `prefer: "later"`.
 */
export function wallClockToUtc(wall: WallClock, timeZone: string, prefer: "earlier" | "later" = "earlier"): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const candidates = new Set<number>();
  for (const probe of [naive - 36e5 * 14, naive, naive + 36e5 * 14]) {
    const off = zoneOffsetMinutes(new Date(probe), timeZone);
    candidates.add(naive - off * 60_000);
  }
  const valid = [...candidates]
    .filter((t) => {
      const back = utcToWallClock(new Date(t), timeZone);
      return formatWall(back) === formatWall(wall);
    })
    .sort((a, b) => a - b);
  if (valid.length === 0) throw new NonexistentLocalTimeError(wall, timeZone);
  return new Date(prefer === "later" ? valid[valid.length - 1]! : valid[0]!);
}

export function utcToWallClock(instant: Date, timeZone: string): WallClock {
  const off = zoneOffsetMinutes(instant, timeZone);
  const d = new Date(instant.getTime() + off * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Parse "2026-11-12T10:00" (no offset) as wall clock. */
export function parseLocalDateTime(value: string): WallClock | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]! };
}
