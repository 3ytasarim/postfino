import Link from "next/link";
import { Plug } from "lucide-react";
import { effectiveCapability, listTemplates } from "@sichttakt/core";
import { utcToWallClock } from "@sichttakt/shared";
import { PageHeader, Empty } from "@/components/ui";
import { ReelComposer } from "@/components/reel-composer";
import { getMessages, fmt } from "@/i18n";
import { requireContext, listVisibleChannels } from "@/lib/server";

export const metadata = { title: "Reels-Editor" };

export default async function ComposeReelPage() {
  const ctx = await requireContext();
  const { t } = await getMessages();
  const channels = (await listVisibleChannels(ctx, ctx.workspace.id)).filter((c) => c.status === "active");
  const withCaps = await Promise.all(
    channels.map(async (c) => ({
      id: c.id,
      name: c.display_name,
      platform: c.platform,
      sandbox: c.is_sandbox,
      coverState: await effectiveCapability(ctx.svc.db, c.platform, c.id, "reel.independent_cover"),
      reelState: await effectiveCapability(ctx.svc.db, c.platform, c.id, "post.reel"),
    })),
  );
  // Default suggestion: next full hour + 1 in the workspace time zone.
  const w = utcToWallClock(new Date(Date.now() + 2 * 3600_000), ctx.workspace.timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultWhen = `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:00`;

  return (
    <>
      <PageHeader eyebrow={ctx.workspace.name} title={t.composer.title} subtitle={t.composer.subtitle} />
      {withCaps.length === 0 ? (
        <Empty icon={Plug} title={t.composer.noChannels}>
          <Link href="/app/channels" className="btn btn-primary mt-2">
            {t.channels.connect}
          </Link>
        </Empty>
      ) : (
        <ReelComposer channels={withCaps} defaultWhen={defaultWhen} timezoneNote={fmt(t.composer.timezoneNote, { tz: ctx.workspace.timezone })} t={t.composer} tb={t.compose} approvalRequired={ctx.workspace.approvalRequired} templates={(await listTemplates(ctx.svc.db, ctx.actor, ctx.workspace.id)).map((x) => ({ id: x.id, name: x.name, kind: x.kind, body: x.body }))} aiConfigured={ctx.svc.ai.configured} tt={{ ai: t.ai, ideas: t.ideasPage, links: t.linksPage }} />
      )}
    </>
  );
}
