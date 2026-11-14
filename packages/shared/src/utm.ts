// UTM builder: appends campaign parameters to http(s) links; existing utm_* parameters are kept.

export type UtmParams = { source: string; medium: string; campaign: string; term?: string; content?: string };

export function buildUtmUrl(url: string, p: UtmParams): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!/^https?:$/.test(u.protocol)) return url;
  const set = (k: string, v?: string) => {
    if (v?.trim() && !u.searchParams.has(k)) u.searchParams.set(k, v.trim());
  };
  set("utm_source", p.source);
  set("utm_medium", p.medium);
  set("utm_campaign", p.campaign);
  set("utm_term", p.term);
  set("utm_content", p.content);
  return u.toString();
}

/** Rewrites every link in a caption; punctuation directly after a URL is preserved. */
export function applyUtmToText(text: string, p: UtmParams): string {
  return text.replace(/https?:\/\/[^\s<>"]+/g, (m) => {
    const trail = /[.,;:!?)\]]+$/.exec(m)?.[0] ?? "";
    return buildUtmUrl(m.slice(0, m.length - trail.length), p) + trail;
  });
}
