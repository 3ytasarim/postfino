// Stable machine-readable error codes. Used by the public API (`error.code`) and the UI.

export const ERROR_CODES = {
  UNAUTHENTICATED: 401,
  INVALID_API_KEY: 401,
  API_KEY_REVOKED: 401,
  API_KEY_EXPIRED: 401,
  FORBIDDEN: 403,
  INSUFFICIENT_SCOPE: 403,
  PLAN_FEATURE_UNAVAILABLE: 403,
  WORKSPACE_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
  VALIDATION_FAILED: 422,
  MEDIA_INVALID: 422,
  CAPABILITY_NOT_SUPPORTED: 422,
  INVALID_STATE_TRANSITION: 409,
  APPROVAL_REQUIRED: 409,
  CHANNEL_NOT_ACTIVE: 409,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_ERROR: 502,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AppError";
    this.status = ERROR_CODES[code];
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
