import type { ApiScope, Role } from "@sichttakt/shared";

// Central permission matrix. UI hiding is cosmetic; every service call checks these on the server.

export const PERMISSIONS = [
  "org.manage",
  "org.billing",
  "org.audit.read",
  "members.manage",
  "workspace.create",
  "workspace.manage",
  "channels.connect",
  "channels.read",
  "media.write",
  "media.read",
  "posts.read",
  "posts.write",
  "posts.approve",
  "posts.publish",
  "posts.delete",
  "ideas.write",
  "community.reply",
  "analytics.read",
  "reports.write",
  "apikeys.manage",
  "webhooks.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS];
const editor: Permission[] = ["channels.read", "media.write", "media.read", "posts.read", "posts.write", "ideas.write", "analytics.read"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: all,
  AGENCY_OWNER: all,
  AGENCY_ADMIN: all.filter((p) => p !== "org.billing"),
  MANAGER: [...editor, "channels.connect", "posts.approve", "posts.publish", "posts.delete", "community.reply", "reports.write", "workspace.manage"],
  EDITOR: [...editor, "community.reply"],
  APPROVER: ["channels.read", "media.read", "posts.read", "posts.approve", "analytics.read"],
  CLIENT_REVIEWER: ["media.read", "posts.read", "posts.approve"],
  VIEWER: ["channels.read", "media.read", "posts.read", "analytics.read"],
};

export const can = (role: Role, p: Permission) => ROLE_PERMISSIONS[role].includes(p);

/** API scopes map onto the same permission vocabulary so services check one thing. */
export const SCOPE_PERMISSIONS: Record<ApiScope, Permission[]> = {
  "workspaces:read": [],
  "accounts:read": ["channels.read"],
  "accounts:connect": ["channels.connect", "channels.read"],
  "media:write": ["media.write", "media.read"],
  "posts:read": ["posts.read"],
  "posts:write": ["posts.write", "posts.read"],
  "posts:publish": ["posts.publish", "posts.approve"],
  "calendar:read": ["posts.read", "channels.read"],
  "analytics:read": ["analytics.read"],
  "webhooks:manage": ["webhooks.manage"],
  "usage:read": [],
};

export type Actor =
  | { kind: "user"; userId: string; organizationId: string; isSuperAdmin: boolean; orgRole: Role | null; workspaceRoles: Record<string, Role> }
  | { kind: "api_key"; apiKeyId: string; organizationId: string; scopes: ApiScope[]; workspaceIds: string[]; environment: "live" | "test" }
  | { kind: "system"; organizationId: string };
