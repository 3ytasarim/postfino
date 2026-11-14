import type { PublishInput, ValidationIssue } from "./types";

// Limits from Meta IG User Media reference (fetched 2026-11-06, Graph API v27.0). Keep in sync with
// docs/PLATFORM_CAPABILITIES.md. Validation runs BEFORE any network call (acceptance criterion §9).

export const IG_REELS_LIMITS = {
  videoMimeTypes: ["video/mp4", "video/quicktime"],
  videoCodecs: ["avc1", "hvc1", "hev1"],
  audioCodecs: ["mp4a"],
  minDurationMs: 3_000,
  maxDurationMs: 15 * 60_000,
  maxVideoBytes: 300 * 1024 * 1024,
  maxWidth: 1920,
  minFps: 23,
  maxFps: 60,
  coverMimeTypes: ["image/jpeg"],
  maxCoverBytes: 8 * 1024 * 1024,
  captionMax: 2200,
  hashtagMax: 30,
  collaboratorsMax: 3,
} as const;

export const IG_CAROUSEL_LIMITS = { minItems: 2, maxItems: 10, maxVideoMs: 60_000 } as const;
export const IG_STORY_LIMITS = { maxVideoMs: 60_000, maxVideoBytes: 100 * 1024 * 1024 } as const;
export const IG_IMAGE_LIMITS = { mimeTypes: ["image/jpeg"], maxBytes: 8 * 1024 * 1024, minRatio: 4 / 5, maxRatio: 1.91 } as const;

const issue = (field: string, code: string, message: string): ValidationIssue => ({ field, code, message });

export function validateInstagram(input: PublishInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const L = IG_REELS_LIMITS;
  if (input.caption.length > L.captionMax) out.push(issue("caption", "caption_too_long", `Max. ${L.captionMax} Zeichen`));
  const hashtags = input.caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? [];
  if (hashtags.length > L.hashtagMax) out.push(issue("caption", "too_many_hashtags", `Max. ${L.hashtagMax} Hashtags`));
  if ((input.options.collaborators?.length ?? 0) > L.collaboratorsMax)
    out.push(issue("collaborators", "too_many_collaborators", `Max. ${L.collaboratorsMax} Collaborators`));
  if (input.options.trial && input.options.collaborators?.length)
    out.push(issue("trial", "trial_with_collaborators", "Testreels können nicht mit Collaborators kombiniert werden"));

  if (input.type === "reel") {
    const v = input.video;
    if (!v) {
      out.push(issue("video", "video_required", "Für Reels ist ein Video erforderlich"));
    } else {
      if (!L.videoMimeTypes.includes(v.mimeType as never)) out.push(issue("video", "video_format", "Nur MP4 oder MOV"));
      if (v.sizeBytes > L.maxVideoBytes) out.push(issue("video", "video_too_large", "Max. 300 MB"));
      if (v.durationMs === undefined) out.push(issue("video", "video_unprobed", "Videodauer konnte nicht ermittelt werden"));
      else if (v.durationMs < L.minDurationMs || v.durationMs > L.maxDurationMs)
        out.push(issue("video", "video_duration", "Dauer muss zwischen 3 Sekunden und 15 Minuten liegen"));
      if (v.width && v.width > L.maxWidth) out.push(issue("video", "video_width", "Max. Breite 1920 px"));
      if (v.videoCodec && !L.videoCodecs.includes(v.videoCodec as never))
        out.push(issue("video", "video_codec", `Codec ${v.videoCodec} nicht unterstützt (H.264/HEVC erforderlich)`));
      if (v.audioCodec && !L.audioCodecs.includes(v.audioCodec as never))
        out.push(issue("video", "audio_codec", `Audio ${v.audioCodec} nicht unterstützt (AAC erforderlich)`));
      if (v.frameRate && (v.frameRate < L.minFps || v.frameRate > L.maxFps))
        out.push(issue("video", "video_fps", "Bildrate muss zwischen 23 und 60 fps liegen"));
    }
    const c = input.cover;
    if (c) {
      if (!L.coverMimeTypes.includes(c.mimeType as never))
        out.push(issue("cover", "cover_format", "Cover muss JPEG sein (PNG wird vor dem Upload konvertiert)"));
      if (c.sizeBytes > L.maxCoverBytes) out.push(issue("cover", "cover_too_large", "Cover max. 8 MB"));
      if (c.width && c.height) {
        const r = c.width / c.height;
        if (Math.abs(r - 9 / 16) > 0.02)
          out.push(issue("cover", "cover_ratio_warning", "Empfohlen 9:16 – Instagram schneidet sonst mittig zu"));
      }
      if (v && c.assetId === v.assetId) out.push(issue("cover", "cover_same_as_video", "Cover und Video müssen getrennte Dateien sein"));
    }
  }

  if (input.type === "image") {
    const m = input.media[0];
    if (!m) out.push(issue("media", "media_required", "Bild erforderlich"));
    else {
      if (!IG_IMAGE_LIMITS.mimeTypes.includes(m.mimeType as never)) out.push(issue("media", "image_format", "Nur JPEG"));
      if (m.sizeBytes > IG_IMAGE_LIMITS.maxBytes) out.push(issue("media", "image_too_large", "Max. 8 MB"));
      if (m.width && m.height) {
        const r = m.width / m.height;
        if (r < IG_IMAGE_LIMITS.minRatio - 0.01 || r > IG_IMAGE_LIMITS.maxRatio + 0.01)
          out.push(issue("media", "image_ratio", "Seitenverhältnis zwischen 4:5 und 1.91:1"));
      }
    }
  }
  if (input.type === "carousel") {
    const n = input.media.length;
    if (n < IG_CAROUSEL_LIMITS.minItems || n > IG_CAROUSEL_LIMITS.maxItems)
      out.push(issue("media", "carousel_count", `Karussell braucht ${IG_CAROUSEL_LIMITS.minItems}–${IG_CAROUSEL_LIMITS.maxItems} Elemente`));
    input.media.forEach((m, i) => {
      const f = `media[${i}]`;
      if (m.kind === "image") {
        if (!IG_IMAGE_LIMITS.mimeTypes.includes(m.mimeType as never)) out.push(issue(f, "image_format", "Nur JPEG"));
        if (m.sizeBytes > IG_IMAGE_LIMITS.maxBytes) out.push(issue(f, "image_too_large", "Max. 8 MB"));
      } else if (m.kind === "video") {
        if (m.durationMs !== undefined && (m.durationMs < 3000 || m.durationMs > IG_CAROUSEL_LIMITS.maxVideoMs)) out.push(issue(f, "video_duration", "Karussell-Videos: 3–60 Sekunden"));
        if (m.videoCodec && !IG_REELS_LIMITS.videoCodecs.includes(m.videoCodec as never)) out.push(issue(f, "video_codec", "H.264/HEVC erforderlich"));
      } else out.push(issue(f, "media_kind", "Nur Bilder und Videos"));
    });
  }

  if (input.type === "story") {
    const m = input.video ?? input.media[0];
    if (!m) out.push(issue("media", "media_required", "Story braucht ein Bild oder Video"));
    else if (m.kind === "image") {
      if (!IG_IMAGE_LIMITS.mimeTypes.includes(m.mimeType as never)) out.push(issue("media", "image_format", "Nur JPEG"));
      if (m.sizeBytes > IG_IMAGE_LIMITS.maxBytes) out.push(issue("media", "image_too_large", "Max. 8 MB"));
    } else if (m.kind === "video") {
      if (m.durationMs !== undefined && (m.durationMs < 3000 || m.durationMs > IG_STORY_LIMITS.maxVideoMs)) out.push(issue("media", "video_duration", "Story-Videos: 3–60 Sekunden"));
      if (m.sizeBytes > IG_STORY_LIMITS.maxVideoBytes) out.push(issue("media", "video_too_large", "Max. 100 MB"));
    }
    if (input.caption.trim()) out.push(issue("caption", "story_caption_warning", "Stories haben keine Beschriftung; Text wird nicht übertragen"));
  }

  if (input.options.firstComment && input.options.firstComment.length > L.captionMax) out.push(issue("firstComment", "first_comment_too_long", `Max. ${L.captionMax} Zeichen`));
  return out;
}

/** Warnings are informational and do not block publishing. */
export const isBlocking = (i: ValidationIssue) => !i.code.endsWith("_warning");
