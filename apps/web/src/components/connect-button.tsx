"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { ConnectChannelDialog } from "./connect-channel-dialog";
import type { Messages } from "@/i18n/de";

export function ConnectButton({ label, configured, sandbox, l, className = "btn btn-primary" }: { label: string; configured: Record<string, boolean>; sandbox: boolean; l: Messages["connectUi"]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        <Plus className="size-4" /> {label}
      </button>
      <ConnectChannelDialog open={open} onClose={() => setOpen(false)} configured={configured} sandbox={sandbox} l={l} />
    </>
  );
}
