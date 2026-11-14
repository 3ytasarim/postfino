import { siInstagram, siFacebook, siTiktok, siYoutube, siX, siThreads, siPinterest, siBluesky, siMastodon, siGoogle, siSubstack } from "simple-icons";

// Network marks (simple-icons, CC0) used to identify the connected network — nominative use only.
// LinkedIn is not part of simple-icons (removed on the brand owner's request), so it gets a plain "in" mark.

type Mark = { path: string; hex: string; title: string };
const MARKS: Record<string, Mark> = {
  instagram_business: siInstagram,
  instagram_personal: siInstagram,
  facebook_page: siFacebook,
  facebook_group: siFacebook,
  tiktok: siTiktok,
  youtube: siYoutube,
  x: siX,
  threads: siThreads,
  pinterest: siPinterest,
  bluesky: siBluesky,
  mastodon: siMastodon,
  google_business: siGoogle,
  substack: siSubstack,
};
export const NETWORK_NAMES: Record<string, string> = {
  instagram_business: "Instagram",
  instagram_personal: "Instagram (privat)",
  facebook_page: "Facebook",
  facebook_group: "Facebook-Gruppe",
  linkedin_profile: "LinkedIn",
  linkedin_page: "LinkedIn Seite",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  threads: "Threads",
  pinterest: "Pinterest",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  google_business: "Google Business",
  substack: "Substack",
  start_page: "Start Page",
  sandbox: "Sandbox",
};

/** Brand colour of a network (charts, legends). */
export const networkColor = (platform: string) => (platform.startsWith("linkedin") ? "#0a66c2" : MARKS[platform] ? `#${MARKS[platform].hex}` : "#6b7280");

/** Network mark. `badge` = small white-ringed circle in brand colour (for avatars); otherwise a monochrome glyph. */
export function NetworkIcon({ platform, size = 16, badge = false, className = "" }: { platform: string; size?: number; badge?: boolean; className?: string }) {
  const m = MARKS[platform];
  const name = NETWORK_NAMES[platform] ?? platform;
  const bg = networkColor(platform);
  const glyph = m ? (
    <svg viewBox="0 0 24 24" width={badge ? size * 0.6 : size} height={badge ? size * 0.6 : size} fill="currentColor" aria-hidden>
      <path d={m.path} />
    </svg>
  ) : (
    <span style={{ fontSize: (badge ? size * 0.55 : size * 0.8), lineHeight: 1 }} className="font-bold" aria-hidden>
      {platform.startsWith("linkedin") ? "in" : name.slice(0, 1)}
    </span>
  );
  if (!badge)
    return (
      <span className={`inline-grid place-items-center ${className}`} role="img" aria-label={name} title={name} style={{ width: size, height: size }}>
        {glyph}
      </span>
    );
  return (
    <span className={`inline-grid place-items-center rounded-full text-white ring-2 ring-surface ${className}`} role="img" aria-label={name} title={name} style={{ width: size, height: size, background: bg }}>
      {glyph}
    </span>
  );
}

/** Channel avatar with the network badge in the corner (sidebar, cards). */
export function ChannelAvatar({ name, avatarUrl, platform, size = 32 }: { name: string; avatarUrl?: string | null; platform: string; size?: number }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="size-full rounded-[10px] object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="grid size-full place-items-center rounded-[10px] bg-surface-2 font-display text-sm font-bold text-ink-2" aria-hidden>
          {name.replace(/^@/, "").slice(0, 1).toUpperCase()}
        </span>
      )}
      <NetworkIcon platform={platform} badge size={Math.round(size * 0.5)} className="absolute -right-1 -bottom-1" />
    </span>
  );
}
