import type { Platform, PostType } from "@sichttakt/shared";
import type { CapabilityMap } from "./capabilities";

export type MediaInfo = {
  assetId: string;
  kind: "image" | "video" | "document";
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  videoCodec?: string;
  audioCodec?: string;
  frameRate?: number;
  /** Time-limited HTTPS URL the provider can fetch. Missing => cannot publish automatically. */
  publicUrl?: string;
};

export type PublishInput = {
  type: PostType;
  caption: string;
  media: MediaInfo[];
  video?: MediaInfo;
  cover?: MediaInfo;
  thumbOffsetMs?: number;
  options: {
    shareToFeed?: boolean;
    firstComment?: string;
    collaborators?: string[];
    locationId?: string;
    trial?: "MANUAL" | "SS_PERFORMANCE";
    /** YouTube video title / Pinterest pin title (falls back to the first caption line). */
    title?: string;
    /** YouTube: public|unlisted|private. TikTok: one of creator_info privacy_level_options (required, no default). */
    privacy?: string;
    /** Destination link (Pinterest pin link, Google Business call-to-action). */
    link?: string;
  };
};

export type ValidationIssue = { field: string; code: string; message: string };

export type ChannelAuth = { accessToken: string; refreshToken?: string; externalId: string; meta: Record<string, unknown> };

export type ConnectedAccount = {
  externalId: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  grantedScopes: string[];
  meta: Record<string, unknown>;
};

export type ContainerStatus = "in_progress" | "ready" | "error" | "expired" | "published";

export type ProviderCallLog = { step: string; request: Record<string, unknown>; response: Record<string, unknown>; durationMs: number };

export type ProviderComment = { id: string; text: string; username?: string; timestamp: string; parentId?: string };

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly providerCode?: string,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class CapabilityNotSupportedError extends Error {
  constructor(readonly capability: string) {
    super(`Capability not supported: ${capability}`);
    this.name = "CapabilityNotSupportedError";
  }
}

export type HttpFetch = typeof fetch;

export type OAuthStart = { state: string; redirectUri: string; codeChallenge?: string; instance?: string };
export type OAuthFinish = { code: string; redirectUri: string; codeVerifier?: string; instance?: string };

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly isMock: boolean;
  getCapabilities(): CapabilityMap;
  validateContent(input: PublishInput): ValidationIssue[];

  /** How the account is connected. Default: OAuth redirect without PKCE. */
  readonly connectMode?: "oauth" | "oauth_pkce" | "oauth_instance" | "credentials" | "manual";
  buildAuthUrl(p: OAuthStart): string | Promise<string>;
  exchangeCode(p: OAuthFinish): Promise<ConnectedAccount[]>;
  /** connectMode "credentials" (Bluesky app password): the password is used once and never stored. */
  connectWithCredentials?(p: { identifier: string; password: string; service?: string }): Promise<ConnectedAccount[]>;
  refreshToken(auth: ChannelAuth): Promise<{ accessToken: string; expiresAt?: Date; refreshToken?: string }>;
  disconnect(auth: ChannelAuth): Promise<void>;

  createMedia(auth: ChannelAuth, input: PublishInput, log: (l: ProviderCallLog) => void): Promise<{ containerId: string }>;
  getPublishStatus(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void): Promise<ContainerStatus>;
  /** `input` is passed for direct-publish platforms (no container step, e.g. Facebook Pages). */
  publish(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void, input?: PublishInput): Promise<{ externalPostId: string }>;
  /** Optional: first comment after publishing. */
  postFirstComment?(auth: ChannelAuth, externalPostId: string, text: string, log: (l: ProviderCallLog) => void): Promise<{ id: string }>;
  getPostUrl(auth: ChannelAuth, externalPostId: string): Promise<string | null>;

  /** Post metrics. `null` = the platform does not provide this metric for this post (shown as N/A, never 0). */
  fetchInsights(auth: ChannelAuth, externalPostId: string): Promise<Record<string, number | null>>;
  /** Account-level metrics (followers etc.). Optional per platform. */
  fetchAccountInsights?(auth: ChannelAuth): Promise<Record<string, number | null>>;
  listComments(auth: ChannelAuth, externalPostId: string): Promise<ProviderComment[]>;
  replyComment(auth: ChannelAuth, commentId: string, text: string): Promise<{ id: string }>;
  listMentions(auth: ChannelAuth): Promise<unknown[]>;
}
