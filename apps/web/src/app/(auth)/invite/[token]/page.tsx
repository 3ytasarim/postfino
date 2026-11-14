import Link from "next/link";
import { getInvite } from "@sichttakt/core";
import { Notice } from "@/components/ui";
import { getMessages, fmt } from "@/i18n";
import { currentSession, services } from "@/lib/server";
import { acceptInviteAction } from "../../actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getMessages();
  const inv = await getInvite(services().db, token);
  const s = await currentSession();
  if (!inv)
    return (
      <>
        <h2 className="mb-6 text-3xl font-bold">{t.team.acceptTitle}</h2>
        <Notice tone="bad">{t.auth.tokenInvalid}</Notice>
      </>
    );
  const sameUser = s && s.user.email.toLowerCase() === inv.email.toLowerCase();
  return (
    <>
      <h2 className="mb-4 text-3xl font-bold">{t.team.acceptTitle}</h2>
      <p className="mb-6 text-ink-2">{fmt(t.team.acceptBody, { org: inv.organizationName, role: inv.role })}</p>
      {sameUser ? (
        <form action={acceptInviteAction}>
          <input type="hidden" name="token" value={token} />
          <button className="btn btn-primary w-full">{t.team.accept}</button>
        </form>
      ) : s ? (
        <Notice tone="warn">{fmt(t.team.wrongAccount, { email: inv.email })}</Notice>
      ) : (
        <>
          <Notice tone="info">{fmt(t.team.loginFirst, { email: inv.email })}</Notice>
          <div className="mt-6 flex gap-2">
            <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="btn btn-primary">
              {t.auth.login}
            </Link>
            <Link href={`/register?invite=${encodeURIComponent(token)}`} className="btn btn-ghost">
              {t.auth.register}
            </Link>
          </div>
        </>
      )}
    </>
  );
}
