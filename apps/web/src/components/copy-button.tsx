"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function CopyButton({ value, label, done }: { value: string; label: string; done: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost !min-h-[32px] !px-2"
      aria-label={ok ? done : label}
      title={ok ? done : label}
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => {});
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </button>
  );
}
