"use client";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { collectInsightsNowAction, syncCommentsNowAction } from "@/app/app/actions-insights";

/** Queues a collection run; tells the truth that results arrive asynchronously. */
export function CollectNow({ label, done, kind = "insights" }: { label: string; done: string; kind?: "insights" | "comments" }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3">
      {msg && (
        <span role="status" className="max-w-xs text-xs text-ink-2">
          {msg}
        </span>
      )}
      <button
        className="btn btn-ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = kind === "comments" ? await syncCommentsNowAction() : await collectInsightsNowAction();
            setMsg(r?.error ?? done);
          })
        }
      >
        <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} /> {label}
      </button>
    </div>
  );
}
