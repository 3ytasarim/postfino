"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  StripeBilling,
  isBillingConfigured,
  startCheckout,
  openBillingPortal,
  adminSetOrganizationPlan,
  adminUpdatePlan,
  updateBranding,
  setCustomDomain,
  verifyCustomDomain,
  markTargetPublishedManually,
  isAppError,
} from "@sichttakt/core";
import { PLAN_FEATURES, type PlanCode } from "@sichttakt/shared";
import { requireContext } from "@/lib/server";
import type { ActionResult } from "./actions";

function fail(e: unknown): ActionResult {
  if (isAppError(e)) return { error: e.message, details: e.details };
  throw e;
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const PLANS = ["starter", "pro", "agency", "enterprise"] as const;
const LIMITS = ["channels", "users", "workspaces", "apiRequestsPerMonth", "apiRequestsPerMinute", "apiKeys", "aiRequestsPerMonth"] as const;

// ── Billing ──
export async function checkoutAction(fd: FormData) {
  const ctx = await requireContext();
  const plan = str(fd, "plan") as PlanCode;
  if (!PLANS.includes(plan as (typeof PLANS)[number])) redirect("/app/billing");
  let url: string;
  try {
    if (!isBillingConfigured(ctx.svc.config)) throw new Error("not configured");
    ({ url } = await startCheckout(ctx.svc.db, new StripeBilling(ctx.svc.config), ctx.actor, { plan, email: ctx.user.email, appUrl: ctx.svc.config.APP_URL, trialDays: ctx.svc.config.STRIPE_TRIAL_DAYS }));
  } catch (e) {
    redirect(`/app/billing?error=${encodeURIComponent(isAppError(e) ? e.message : "billing_not_configured")}`);
  }
  redirect(url);
}

export async function portalAction() {
  const ctx = await requireContext();
  let url: string;
  try {
    ({ url } = await openBillingPortal(ctx.svc.db, new StripeBilling(ctx.svc.config), ctx.actor, ctx.svc.config.APP_URL));
  } catch (e) {
    redirect(`/app/billing?error=${encodeURIComponent(isAppError(e) ? e.message : "portal_failed")}`);
  }
  redirect(url);
}

// ── Platform admin ──
const limitsFrom = (fd: FormData, prefix: string) => Object.fromEntries(LIMITS.filter((k) => fd.has(`${prefix}${k}`)).map((k) => [k, str(fd, `${prefix}${k}`)]));

export async function adminOrgAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await adminSetOrganizationPlan(ctx.svc.db, ctx.actor, str(fd, "organizationId"), {
      planCode: (str(fd, "plan") || undefined) as PlanCode | undefined,
      status: str(fd, "status") || undefined,
      limitOverrides: Object.fromEntries(Object.entries(limitsFrom(fd, "o_")).filter(([, v]) => v !== "")),
    });
    revalidatePath("/app/admin");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function adminPlanAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const price = str(fd, "price");
    await adminUpdatePlan(ctx.svc.db, ctx.actor, str(fd, "code") as PlanCode, {
      monthlyPriceCents: price === "" ? null : Number(price),
      limits: limitsFrom(fd, "l_"),
      features: fd.getAll("features").map(String).filter((f) => (PLAN_FEATURES as readonly string[]).includes(f)),
    });
    revalidatePath("/app/admin");
    revalidatePath("/app/billing");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── White-label ──
export async function brandingAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await updateBranding(ctx.svc.db, ctx.actor, { appName: str(fd, "appName"), logoAssetId: str(fd, "logoAssetId") || null, accentColor: str(fd, "accentColor"), hidePoweredBy: fd.get("hidePoweredBy") === "on" });
    revalidatePath("/app/branding");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function domainAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await setCustomDomain(ctx.svc.db, ctx.actor, fd.get("remove") ? null : str(fd, "domain"));
    revalidatePath("/app/branding");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function verifyDomainAction(_: ActionResult): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const r = await verifyCustomDomain(ctx.svc.db, ctx.actor);
    revalidatePath("/app/branding");
    return r.verified ? { ok: true } : { error: "dns_record_not_found" };
  } catch (e) {
    return fail(e);
  }
}

// ── Manual publish ──
export async function markPublishedAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await markTargetPublishedManually(ctx.svc.db, ctx.actor, str(fd, "targetId"), { permalink: str(fd, "permalink") || undefined });
    revalidatePath(`/app/posts/${str(fd, "postId")}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
