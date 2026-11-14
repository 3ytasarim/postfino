import Link from "next/link";
import { Plug } from "lucide-react";
import { effectiveCapability, getEntitlements, listTemplates } from "@sichttakt/core";
import { utcToWallClock } from "@sichttakt/shared";
import { PageHeader, Empty } from "@/components/ui";
import { PostComposer, type ComposerChannel } from "@/components/post-composer";
import { getMessages, fmt } from "@/i18n";
import { requireContext, listVisibleChannels } from "@/lib/server";

export const metadata = { title: "Neuer Beitrag" };

const TYPES = ["image", "carousel", "story", "text", "video", "thread"] as const;
const CAP = { image: "post.image", carousel: "post.carousel", story: "post.story", text: "post.text", video: "post.video", thread: "post.thread" } as const;

export default async function ComposePostPage({ searchParams }: { searchParams: Promise<{ caption?: string }> }) {
  const initialCaption = String((await searchParams).caption ?? "").slice(0, 5000);
  const ctx = await requireContext();
  const { t } = await getMessages();
  const [channels, ent] = await Promise.all([listVisibleChannels(ctx, ctx.workspace.id), getEntitlements(ctx.svc.db, ctx.organization.id)]);
  const active = channels.filter((c) => c.status === "active");
  const withCaps: ComposerChannel[] = await Promise.all(
    active.map(async (c) => ({
      id: c.id,
      name: c.display_name,
      platform: c.platform,
      sandbox: c.is_sandbox,
      caps: Object.fromEntries(await Promise.all(TYPES.map(async (ty) => [ty, await effectiveCapability(ctx.svc.db, c.platform, c.id, CAP[ty])]))),
      firstComment: await effectiveCapability(ctx.svc.db, c.platform, c.id, "post.first_comment"),
    })),
  );
  const w = utcToWallClock(new Date(Date.now() + 2 * 3600_000), ctx.workspace.timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <>
      <PageHeader
        eyebrow={ctx.workspace.name}
        title={t.compose.title}
        subtitle={t.compose.mediaHint}
        actions={
          <Link href="/app/compose/reel" className="btn btn-ghost">
            {t.compose.reelLink}
          </Link>
        }
      />
      {withCaps.length === 0 ? (
        <Empty icon={Plug} title={t.composer.noChannels}>
          <Link href="/app/channels" className="btn btn-primary mt-2">
            {t.channels.connect}
          </Link>
        </Empty>
      ) : (
        <PostComposer
          channels={withCaps}
          defaultWhen={`${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:00`}
          timezoneNote={fmt(t.composer.timezoneNote, { tz: ctx.workspace.timezone })}
          firstCommentAllowed={ent.features.has("first_comment")}
          t={{ compose: t.compose, composer: t.composer }}
          templates={(await listTemplates(ctx.svc.db, ctx.actor, ctx.workspace.id)).map((x) => ({ id: x.id, name: x.name, kind: x.kind, body: x.body }))}
          aiConfigured={ctx.svc.ai.configured}
          tt={{ ai: t.ai, ideas: t.ideasPage, links: t.linksPage }}
          initialCaption={initialCaption}
        />
      )}
    </>
  );
}
