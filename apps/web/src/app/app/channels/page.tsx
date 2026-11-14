import Link from "next/link";
import { Plug, BellRing, AlertTriangle, CalendarDays } from "lucide-react";
import { isPlatformConfigured, PLATFORM_ENV } from "@sichttakt/core";
import type { Platform } from "@sichttakt/shared";
import { PageHeader, Empty, Notice } from "@/components/ui";
import { ChannelAvatar, NETWORK_NAMES } from "@/components/network-icon";
import { ConnectButton } from "@/components/connect-button";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext, listVisibleChannels } from "@/lib/server";
import { disconnectChannelAction } from "../actions";

export const metadata = { title: "Kanäle" };

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const channels = (await listVisibleChannels(ctx, ctx.workspace.id)).filter((c) => c.status !== "disconnected");
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" });
  const configured = Object.fromEntries(Object.keys(PLATFORM_ENV).map((p) => [p, isPlatformConfigured(ctx.svc.config, p as Platform)]));
  const connect = <ConnectButton label={t.nav.connectNewChannel} configured={configured} sandbox={ctx.svc.config.SANDBOX_ENABLED === "true"} l={t.connectUi} />;

  return (
    <>
      <PageHeader title={t.channels.title} subtitle={t.channels.subtitle} actions={channels.length > 0 ? connect : undefined} />
      {sp.connected && (
        <div className="mb-6">
          <Notice tone="ok">{t.channelsUi.connectedOk.replace("{n}", sp.connected)}</Notice>
        </div>
      )}
      {sp.error && (
        <div className="mb-6">
          <Notice tone="bad">{sp.error}</Notice>
        </div>
      )}

      {channels.length === 0 ? (
        <Empty icon={Plug} title={t.channelsUi.emptyTitle}>
          <p className="mb-4 max-w-md">{t.channelsUi.emptyBody}</p>
          {connect}
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {channels.map((c) => {
            const manual = c.granted_scopes.includes("notification");
            return (
              <li key={c.id} className="card flex flex-col p-5">
                <div className="flex items-center gap-3">
                  <ChannelAvatar name={c.display_name} avatarUrl={c.avatar_url} platform={c.platform} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.display_name}</p>
                    <p className="truncate text-xs text-ink-3">
                      {NETWORK_NAMES[c.platform] ?? c.platform}
                      {c.username ? ` · @${c.username.replace(/^@/, "")}` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  {c.status === "needs_reauth" ? (
                    <span className="chip bg-bad-soft text-bad">
                      <AlertTriangle className="size-3" /> {t.health.reauth}
                    </span>
                  ) : (
                    <span className="chip bg-ok-soft text-ok">{t.channelsUi.active}</span>
                  )}
                  {manual && (
                    <span className="chip bg-surface-2 text-ink-2">
                      <BellRing className="size-3" /> {t.connectUi.notifyOnly}
                    </span>
                  )}
                  {c.is_sandbox && <span className="chip bg-warn-soft text-warn">Sandbox · MOCK</span>}
                  <span className="text-ink-3">
                    {t.channelsUi.since} {df.format(new Date(c.connected_at))}
                  </span>
                </div>
                <div className="mt-auto flex gap-2 pt-5">
                  <Link href={`/app/channels/${c.id}/queue`} className="btn btn-ghost !min-h-[38px] flex-1 text-sm">
                    <CalendarDays className="size-4" /> {t.queue.plan}
                  </Link>
                  <form action={disconnectChannelAction}>
                    <input type="hidden" name="channelId" value={c.id} />
                    <button className="btn btn-ghost !min-h-[38px] text-sm text-bad">{t.channels.disconnect}</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
