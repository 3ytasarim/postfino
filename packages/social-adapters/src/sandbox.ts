import { PLATFORM_CAPABILITIES } from "./capabilities";
import { validateInstagram } from "./instagram-validation";
import type { ChannelAuth, ContainerStatus, PlatformAdapter, ProviderCallLog, ProviderComment, PublishInput } from "./types";
import { ProviderError } from "./types";

// SANDBOX / MOCK adapter. Never contacts a network. Used for local development, tests and the public API
// sandbox (`st_test_` keys). Every channel using it is flagged `is_sandbox=true` and labelled in the UI.
// Behaviour knobs via caption markers so tests can force failures:
//   "#fail-retry"  → retryable provider error on publish
//   "#fail-final"  → final provider error on publish

export class SandboxAdapter implements PlatformAdapter {
  readonly platform = "sandbox" as const;
  readonly isMock = true;
  /** Count of real publish calls — lets tests assert "published exactly once". */
  publishCalls = 0;
  private containers = new Map<string, { input: PublishInput; polls: number }>();

  getCapabilities() {
    return PLATFORM_CAPABILITIES.sandbox;
  }
  validateContent(input: PublishInput) {
    return validateInstagram(input);
  }
  buildAuthUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
    const u = new URL(redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("code", "sandbox-code");
    return u.toString();
  }
  async exchangeCode() {
    return [
      {
        externalId: `sandbox_${Math.random().toString(36).slice(2, 10)}`,
        displayName: "Sandbox Instagram (MOCK)",
        username: "sichttakt.sandbox",
        accessToken: "sandbox-token",
        grantedScopes: ["sandbox"],
        meta: { mock: true },
      },
    ];
  }
  async refreshToken() {
    return { accessToken: "sandbox-token" };
  }
  async disconnect() {}

  async createMedia(_auth: ChannelAuth, input: PublishInput, log: (l: ProviderCallLog) => void) {
    const containerId = `sbx_container_${crypto.randomUUID()}`;
    this.containers.set(containerId, { input, polls: 0 });
    log({ step: "create_container", request: { mock: true, type: input.type, hasCover: Boolean(input.cover) }, response: { id: containerId }, durationMs: 0 });
    return { containerId };
  }
  async getPublishStatus(_auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void): Promise<ContainerStatus> {
    const c = this.containers.get(containerId);
    log({ step: "poll", request: { containerId }, response: { status: c ? "FINISHED" : "EXPIRED", mock: true }, durationMs: 0 });
    return c ? "ready" : "expired";
  }
  async publish(_auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void) {
    const c = this.containers.get(containerId);
    if (c?.input.caption.includes("#fail-retry")) throw new ProviderError("sandbox transient failure", true, "SANDBOX_TRANSIENT");
    if (c?.input.caption.includes("#fail-final")) throw new ProviderError("sandbox permanent failure", false, "SANDBOX_FINAL");
    this.publishCalls++;
    const externalPostId = `sbx_post_${crypto.randomUUID()}`;
    log({ step: "publish", request: { containerId }, response: { id: externalPostId, mock: true }, durationMs: 0 });
    return { externalPostId };
  }
  firstComments: { postId: string; text: string }[] = [];
  async postFirstComment(_auth: ChannelAuth, externalPostId: string, text: string, log: (l: ProviderCallLog) => void) {
    if (text.includes("#fail-comment")) throw new ProviderError("sandbox comment failure", false, "SANDBOX_COMMENT");
    this.firstComments.push({ postId: externalPostId, text });
    log({ step: "first_comment", request: { mock: true }, response: { id: "sbx_comment" }, durationMs: 0 });
    return { id: "sbx_comment" };
  }
  async getPostUrl(_auth: ChannelAuth, id: string) {
    return `https://sandbox.sichttakt.invalid/p/${id}`;
  }
  /** Sandbox has no audience: every metric is N/A (never fabricated). */
  async fetchInsights(_auth?: ChannelAuth, _externalPostId?: string): Promise<Record<string, number | null>> {
    return { likes: null, comments: null, reach: null, views: null, saves: null, shares: null, interactions: null };
  }
  async fetchAccountInsights(_auth?: ChannelAuth): Promise<Record<string, number | null>> {
    return { followers: null, media_count: null, profile_views: null, reach: null };
  }
  async listComments(_auth?: ChannelAuth, _externalPostId?: string): Promise<ProviderComment[]> {
    return [];
  }
  async replyComment(_auth?: ChannelAuth, _commentId?: string, _text?: string): Promise<{ id: string }> {
    return { id: "sbx_reply" };
  }
  async listMentions() {
    return [];
  }
}
