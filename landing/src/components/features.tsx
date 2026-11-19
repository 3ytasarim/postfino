"use client";
import type { PointerEvent, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTick } from "@/lib/use-tick";
import { BarChart3, CalendarClock, Code2, Inbox, Lightbulb, Link2, Palette, Sparkles, Users, Wand2 } from "lucide-react";
import { Reveal, SectionHead } from "./reveal";
import { NetworkIcon, networkColor } from "./network-icon";

const track = (e: PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
};

function Card({ icon, title, text, className = "", children, delay = 0, plan }: { icon: ReactNode; title: string; text: string; className?: string; children?: ReactNode; delay?: number; plan?: string }) {
  return (
    <Reveal delay={delay} className={className}>
      <article onPointerMove={track} className="spot group flex h-full flex-col overflow-hidden rounded-[28px] bg-surface p-6 shadow-[0_20px_50px_-30px_rgba(16,40,110,0.35)] ring-1 ring-line transition-transform duration-500 hover:-translate-y-1">
        <div className="flex items-center justify-between">
          <span className="grid size-11 place-items-center rounded-2xl bg-cobalt/[0.08] text-cobalt-2 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[-6deg]">{icon}</span>
          {plan && <span className="rounded-full bg-paper px-2.5 py-1 text-[0.7rem] font-semibold text-ink-3 ring-1 ring-line">{plan}</span>}
        </div>
        <h3 className="mt-5 font-display text-xl font-bold tracking-tight">{title}</h3>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-2">{text}</p>
        {children && <div className="mt-6 flex-1">{children}</div>}
      </article>
    </Reveal>
  );
}

const WEEK = [
  { d: "Mo", n: 10, posts: [["instagram_business", "09:00", "Neues Menü ab Freitag", "from-pink-300 via-rose-200 to-orange-100"], ["linkedin_page", "12:30", "3 Tipps für mehr Reichweite", "from-sky-300 via-blue-200 to-indigo-100"]] },
  { d: "Di", n: 11, posts: [["tiktok", "18:00", "Behind the scenes", "from-zinc-400 via-slate-200 to-cyan-100"]] },
  { d: "Mi", n: 12, posts: [["facebook_page", "10:15", "Event-Ankündigung", "from-blue-300 via-indigo-200 to-violet-100"], ["threads", "16:00", "Frage an die Community", "from-neutral-300 via-zinc-200 to-stone-100"], ["pinterest", "20:00", "Moodboard Herbst", "from-red-300 via-rose-200 to-amber-100"]] },
  { d: "Do", n: 13, posts: [["youtube", "17:45", "Tutorial: Teil 2", "from-red-300 via-orange-200 to-yellow-100"]] },
  { d: "Fr", n: 14, posts: [["instagram_business", "11:00", "Wochenrückblick", "from-fuchsia-300 via-pink-200 to-rose-100"], ["x", "15:30", "Kurz-Update", "from-slate-300 via-gray-200 to-zinc-100"]] },
  { d: "Sa", n: 15, posts: [] },
  { d: "So", n: 16, posts: [["bluesky", "10:00", "Sonntagsfrage", "from-sky-300 via-cyan-200 to-teal-100"]] },
] as const;

/** Week strip: a pill glides from day to day, that day's posts slide in as cards. */
function MiniCalendar() {
  const t = useTick(2600);
  const day = t % WEEK.length;
  const cur = WEEK[day];
  return (
    <div className="rounded-[22px] bg-gradient-to-br from-[var(--mock-a)] via-surface to-[var(--mock-b)] p-3 ring-1 ring-line" aria-hidden>
      <div className="grid grid-cols-7 gap-1 rounded-2xl bg-surface/80 p-1 ring-1 ring-line">
        {WEEK.map((w, i) => (
          <div key={w.d} className="relative flex flex-col items-center rounded-xl py-2">
            {i === day && <motion.span layoutId="week-pill" className="absolute inset-0 rounded-xl bg-contrast shadow-[0_10px_24px_-10px_rgba(11,16,32,0.7)]" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
            <span className={`relative text-[0.65rem] font-bold tracking-wide uppercase transition-colors ${i === day ? "text-on-contrast/60" : "text-ink-3"}`}>{w.d}</span>
            <span className={`relative font-display text-base font-bold transition-colors ${i === day ? "text-on-contrast" : "text-ink"}`}>{w.n}</span>
            <span className="relative mt-1 flex h-1.5 gap-0.5">
              {w.posts.map((p, k) => (
                <span key={k} className="size-1.5 rounded-full" style={{ background: i === day ? "var(--color-on-contrast)" : networkColor(p[0]) }} />
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="strip-fade relative mt-2 -mx-2 h-[140px] overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={day} className="absolute inset-x-2 top-1.5 bottom-3 flex gap-2.5" initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -60, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 28 }}>
            {cur.posts.length === 0 ? (
              <div className="grid flex-1 place-items-center rounded-2xl border-2 border-dashed border-line text-sm font-semibold text-ink-3">+ Lücke füllen</div>
            ) : (
              cur.posts.map(([p, time, text, tone], k) => (
                <motion.div key={text} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.08 + k * 0.08, type: "spring", stiffness: 300, damping: 24 }} className="flex min-w-0 max-w-[190px] flex-1 flex-col rounded-2xl bg-surface p-2 shadow-[0_12px_28px_-16px_rgba(16,40,110,0.5)] ring-1 ring-line">
                  <span className={`relative block h-14 rounded-xl bg-gradient-to-br ${tone}`}>
                    <span className="absolute top-1.5 left-1.5">
                      <NetworkIcon platform={p} badge size={20} />
                    </span>
                    {k === 0 && (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.9, type: "spring", stiffness: 420, damping: 16 }} className="absolute top-1.5 right-1.5 rounded-full bg-mint px-1.5 py-0.5 text-[0.6rem] font-bold text-white">
                        ✓ live
                      </motion.span>
                    )}
                  </span>
                  <span className="mt-2 truncate text-xs font-semibold">{text}</span>
                  <span className="mt-0.5 text-[0.7rem] font-medium text-ink-3">{time} Uhr</span>
                </motion.div>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function MiniChart() {
  const t = useTick(2600);
  const sets = [
    [18, 26, 22, 34, 30, 44, 40, 56, 52, 66],
    [22, 20, 30, 28, 40, 36, 50, 48, 60, 58],
    [14, 24, 30, 26, 38, 48, 44, 52, 62, 70],
  ];
  const pts = sets[t % sets.length];
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * 300},${80 - v}`).join(" ");
  return (
    <svg viewBox="0 0 300 84" className="w-full" aria-hidden>
      <defs>
        <linearGradient id="fc" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1d5bd8" stopOpacity=".25" />
          <stop offset="1" stopColor="#1d5bd8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path initial={false} d={`${d} L300,84 L0,84 Z`} animate={{ d: `${d} L300,84 L0,84 Z` }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} fill="url(#fc)" />
      <motion.path key={t} d={d} fill="none" stroke="#1d5bd8" strokeWidth="2.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }} />
      <motion.circle initial={false} cx={296} cy={80 - pts[pts.length - 1]} r="5" fill="#1d5bd8" stroke="var(--color-surface)" strokeWidth="2.5" animate={{ cx: 300 - 4, cy: 80 - pts[pts.length - 1] }} transition={{ duration: 1.2 }} />
    </svg>
  );
}

const MSGS = [
  ["instagram_business", "Wann öffnet ihr am Sonntag?"],
  ["facebook_page", "Danke für den tollen Service!"],
  ["linkedin_page", "Gibt es die Folien zum Vortrag?"],
  ["youtube", "Kommt noch ein Teil 3?"],
  ["tiktok", "Welcher Song ist das? 😍"],
  ["threads", "Mega Aktion, bin dabei!"],
] as const;

function MiniInbox() {
  const t = useTick(2000);
  const rows = [0, 1, 2].map((k) => MSGS[(t + MSGS.length - k) % MSGS.length]);
  return (
    <ul className="space-y-2" aria-hidden>
      <AnimatePresence initial={false} mode="popLayout">
        {rows.map(([p, text], i) => (
          <motion.li layout key={text} className="flex items-center gap-2.5 rounded-2xl bg-paper px-3 py-2.5 ring-1 ring-line" initial={{ opacity: 0, y: -24, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 340, damping: 28 }}>
            <NetworkIcon platform={p} badge size={22} />
            <span className="truncate text-sm">{text}</span>
            {i === 0 && <span className="ml-auto size-2 shrink-0 rounded-full bg-sky" />}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

export function Features() {
  return (
    <section id="funktionen" className="relative px-4 py-14 sm:py-20">
      <SectionHead eyebrow="Funktionen" title={<>Alles, was dein Social-Media-Alltag braucht.</>} lead="Von der ersten Idee bis zur Auswertung – in einer ruhigen, übersichtlichen Oberfläche statt in zehn Browser-Tabs." />
      <div className="mx-auto mt-10 grid max-w-6xl gap-4 md:grid-cols-6">
        <Card className="md:col-span-4" icon={<CalendarClock className="size-5" />} title="Planen & Veröffentlichen" text="Kalender mit Wochen- und Monatsansicht, Warteschlange und Drag & Drop. Ein Beitrag, mehrere Kanäle – mit Anpassungen pro Netzwerk.">
          <MiniCalendar />
        </Card>
        <Card className="md:col-span-2" delay={0.08} icon={<Inbox className="size-5" />} title="Community-Postfach" text="Kommentare und Nachrichten der verbundenen Kanäle an einem Ort beantworten.">
          <MiniInbox />
        </Card>
        <Card className="md:col-span-2" icon={<BarChart3 className="size-5" />} title="Insights" text="Reichweite, Interaktionen und beste Zeiten – verständlich aufbereitet.">
          <MiniChart />
        </Card>
        <Card className="md:col-span-2" delay={0.08} icon={<Lightbulb className="size-5" />} title="Ideen-Board" text="Ideen sammeln, sortieren und mit einem Klick zum Entwurf machen." />
        <Card className="md:col-span-2" delay={0.16} icon={<Sparkles className="size-5" />} title="KI-Schreibassistent" text="Texte umformulieren, kürzen, Hashtags vorschlagen. KI-Vorschläge sind als solche gekennzeichnet." />
        <Card className="md:col-span-2" icon={<Users className="size-5" />} title="Team & Freigaben" text="Rollen, Kommentare und Freigabe-Workflows für Teams und Kunden." plan="ab Pro" />
        <Card className="md:col-span-2" delay={0.08} icon={<Link2 className="size-5" />} title="Start Page & Kurzlinks" text="Deine Link-in-Bio-Seite und gekürzte Links mit Klickzahlen." />
        <Card className="md:col-span-2" delay={0.16} icon={<Code2 className="size-5" />} title="API & Webhooks" text="Automatisiere Abläufe mit der REST-API und Webhooks." plan="ab Pro" />
        <Card className="md:col-span-3" icon={<Wand2 className="size-5" />} title="Kunden-Workspaces" text="Für Agenturen: getrennte Arbeitsbereiche je Kunde, gebrandete Berichte und Freigaben durch den Kunden." plan="ab Agency" />
        <Card className="md:col-span-3" delay={0.08} icon={<Palette className="size-5" />} title="White-Label & SSO" text="Eigene Marke, Single Sign-on und IP-Allowlist für größere Organisationen." plan="Enterprise" />
      </div>
    </section>
  );
}
