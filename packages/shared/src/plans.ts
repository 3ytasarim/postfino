import type { PlanCode } from "./enums";

// DRAFT plan defaults. Not a price commitment: the source of truth at runtime is the
// `subscription_plans` table, editable by SUPER_ADMIN. These values only seed that table.

export const PLAN_FEATURES = ["public_api", "webhooks", "client_workspaces", "approvals", "team", "branded_reports", "independent_reel_cover", "first_comment", "sso", "white_label", "ip_allowlist"] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export type PlanDefinition = {
  code: PlanCode;
  name: string;
  monthlyPriceCents: number | null; // null = on request (Enterprise)
  limits: {
    channels: number | null; // null = negotiated / unlimited
    users: number | null;
    workspaces: number | null;
    apiRequestsPerMonth: number; // 0 = API disabled
    apiRequestsPerMinute: number; // burst control per key
    apiKeys: number;
    aiRequestsPerMonth: number; // AI assistant generations (draft limits)
  };
  features: PlanFeature[];
};

export const PLAN_DEFAULTS: Record<PlanCode, PlanDefinition> = {
  starter: {
    code: "starter",
    name: "Starter",
    monthlyPriceCents: 1900,
    limits: { channels: 3, users: 1, workspaces: 1, apiRequestsPerMonth: 0, apiRequestsPerMinute: 0, apiKeys: 0, aiRequestsPerMonth: 100 },
    features: ["independent_reel_cover"],
  },
  pro: {
    code: "pro",
    name: "Pro",
    monthlyPriceCents: 5900,
    limits: { channels: 10, users: 3, workspaces: 3, apiRequestsPerMonth: 10_000, apiRequestsPerMinute: 60, apiKeys: 5, aiRequestsPerMonth: 1000 },
    features: ["public_api", "webhooks", "team", "independent_reel_cover", "first_comment"],
  },
  agency: {
    code: "agency",
    name: "Agency",
    monthlyPriceCents: 14900,
    limits: { channels: 30, users: 10, workspaces: 50, apiRequestsPerMonth: 100_000, apiRequestsPerMinute: 300, apiKeys: 25, aiRequestsPerMonth: 5000 },
    features: [
      "public_api",
      "webhooks",
      "team",
      "client_workspaces",
      "approvals",
      "branded_reports",
      "independent_reel_cover",
      "first_comment",
    ],
  },
  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    monthlyPriceCents: null,
    limits: { channels: null, users: null, workspaces: null, apiRequestsPerMonth: 1_000_000, apiRequestsPerMinute: 1200, apiKeys: 100, aiRequestsPerMonth: 20000 },
    features: [
      "public_api",
      "webhooks",
      "team",
      "client_workspaces",
      "approvals",
      "branded_reports",
      "independent_reel_cover",
      "first_comment",
      "sso",
      "white_label",
      "ip_allowlist",
    ],
  },
};
