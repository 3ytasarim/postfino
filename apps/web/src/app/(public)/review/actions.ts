"use server";
import { headers } from "next/headers";
import { decideViaPortal, isAppError, takeBurstToken } from "@sichttakt/core";
import { services } from "@/lib/server";

export type ReviewState = { ok?: boolean; error?: string } | undefined;

const MESSAGES: Record<string, string> = {
  reviewer_name_required: "Bitte deinen Namen angeben.",
  comment_required_for_changes: "Bitte beschreibe die gewünschten Änderungen im Kommentar.",
  review_link_invalid_or_expired: "Dieser Link ist nicht mehr gültig.",
};

export async function reviewDecisionAction(_: ReviewState, fd: FormData): Promise<ReviewState> {
  // Public endpoint: throttle per client IP.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!takeBurstToken(`review:${ip}`, 10).ok) return { error: "Zu viele Versuche. Bitte kurz warten." };
  const decision = fd.get("decision") === "changes_requested" ? "changes_requested" : "approved";
  try {
    await decideViaPortal(services().db, String(fd.get("token") ?? ""), { decision, reviewerName: String(fd.get("name") ?? ""), comment: String(fd.get("comment") ?? "") || undefined });
    return { ok: true };
  } catch (e) {
    if (isAppError(e)) return { error: MESSAGES[e.message] ?? e.message };
    throw e;
  }
}
