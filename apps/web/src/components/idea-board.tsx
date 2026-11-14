"use client";
import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { moveIdeaAction } from "@/app/app/actions-content";

type Idea = { id: string; title: string; body: string; columnId: string; tags: string[]; source: string };

export function IdeaBoard({ columns, ideas }: { columns: { id: string; name: string }[]; ideas: Idea[] }) {
  const [items, move] = useOptimistic(ideas, (cur, m: { id: string; columnId: string; index: number }) => {
    const it = cur.find((i) => i.id === m.id);
    if (!it) return cur;
    const rest = cur.filter((i) => i.id !== m.id);
    const col = rest.filter((i) => i.columnId === m.columnId);
    const before = col[m.index];
    const moved = { ...it, columnId: m.columnId };
    const at = before ? rest.indexOf(before) : rest.length;
    return [...rest.slice(0, at), moved, ...rest.slice(at)];
  });
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const dragging = useRef<string | null>(null);

  function drop(columnId: string, index: number, id: string) {
    if (!id) return;
    start(async () => {
      move({ id, columnId, index });
      const r = await moveIdeaAction(id, columnId, index);
      setError(r?.error ?? null);
    });
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded-[12px] bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex gap-4 overflow-x-auto pb-3">
        {columns.map((col) => {
          const list = items.filter((i) => i.columnId === col.id);
          return (
            <section
              key={col.id}
              aria-label={col.name}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.id);
              }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                drop(col.id, list.length, e.dataTransfer.getData("text/plain") || dragging.current || "");
                dragging.current = null;
              }}
              className={`flex w-[290px] shrink-0 flex-col rounded-[16px] border p-3 transition-colors ${over === col.id ? "border-takt bg-takt-soft/30" : "border-line bg-surface-2/50"}`}
            >
              <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-bold">
                {col.name} <span className="rounded-full bg-surface px-2 text-xs text-ink-3">{list.length}</span>
              </h2>
              <ul className="flex min-h-[80px] flex-col gap-2">
                {list.map((i) => (
                  <li key={i.id}>
                    <Link
                      href={`/app/ideas?tab=board&idea=${i.id}`}
                      draggable
                      onDragStart={(e) => {
                        dragging.current = i.id;
                        e.dataTransfer.setData("text/plain", i.id);
                      }}
                      className="block cursor-grab rounded-[12px] border border-line bg-surface p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing"
                    >
                      <p className="font-semibold">{i.title}</p>
                      {i.body && <p className="mt-1 line-clamp-2 text-xs text-ink-2">{i.body}</p>}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {i.source !== "manual" && <span className="chip bg-puls-soft text-puls">{i.source}</span>}
                        {i.tags.map((tg) => (
                          <span key={tg} className="chip bg-surface-2 text-ink-3">#{tg}</span>
                        ))}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
