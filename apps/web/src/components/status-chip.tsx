import type { PostStatus } from "@sichttakt/shared";

const tone: Record<PostStatus, string> = {
  IDEA: "bg-surface-2 text-ink-2",
  DRAFT: "bg-surface-2 text-ink-2",
  PENDING_APPROVAL: "bg-puls-soft text-puls",
  CHANGES_REQUESTED: "bg-warn-soft text-warn",
  APPROVED: "bg-ok-soft text-ok",
  SCHEDULED: "bg-takt-soft text-takt",
  PREPARING_MEDIA: "bg-puls-soft text-puls",
  PUBLISHING: "bg-puls-soft text-puls",
  PUBLISHED: "bg-ok-soft text-ok",
  FAILED_RETRYABLE: "bg-warn-soft text-warn",
  FAILED_FINAL: "bg-bad-soft text-bad",
  NOTIFICATION_SENT: "bg-puls-soft text-puls",
  CANCELLED: "bg-surface-2 text-ink-3",
};

export function StatusChip({ status, label }: { status: PostStatus; label: string }) {
  return (
    <span className={`chip ${tone[status]}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
