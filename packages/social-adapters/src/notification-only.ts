import { PLATFORM_CAPABILITIES } from "./capabilities";
import { CapabilityNotSupportedError, type ChannelAuth, type ConnectedAccount, type ContainerStatus, type PlatformAdapter, type PublishInput } from "./types";

// Channels without an official publishing API (Instagram personal accounts, Facebook groups, Substack Notes).
// They are added by name only — no token, no network call. Posts to them run in notification mode: the team gets a
// reminder at the scheduled time, posts by hand and confirms ("als veröffentlicht markieren").

export const NOTIFICATION_ONLY_PLATFORMS = ["instagram_personal", "facebook_group", "substack"] as const;
export type NotificationOnlyPlatform = (typeof NOTIFICATION_ONLY_PLATFORMS)[number];

export class NotificationOnlyAdapter implements PlatformAdapter {
  readonly isMock = false;
  readonly connectMode = "manual" as const;
  constructor(readonly platform: NotificationOnlyPlatform) {}

  getCapabilities() {
    return PLATFORM_CAPABILITIES[this.platform];
  }
  validateContent(_input: PublishInput) {
    return []; // the user posts by hand; the network's own app validates
  }
  buildAuthUrl(): string {
    throw new CapabilityNotSupportedError("oauth");
  }
  async exchangeCode(): Promise<ConnectedAccount[]> {
    throw new CapabilityNotSupportedError("oauth");
  }
  async refreshToken(auth: ChannelAuth) {
    return { accessToken: auth.accessToken };
  }
  async disconnect() {}
  async createMedia(): Promise<{ containerId: string }> {
    throw new CapabilityNotSupportedError("automatic_publishing");
  }
  async getPublishStatus(): Promise<ContainerStatus> {
    return "error";
  }
  async publish(): Promise<{ externalPostId: string }> {
    throw new CapabilityNotSupportedError("automatic_publishing");
  }
  async getPostUrl() {
    return null;
  }
  async fetchInsights() {
    return {};
  }
  async listComments() {
    return [];
  }
  async replyComment(): Promise<{ id: string }> {
    throw new CapabilityNotSupportedError("community.comments_reply");
  }
  async listMentions() {
    return [];
  }
}
