import Link from "next/link";
import { verifyEmail, isAppError } from "@sichttakt/core";
import { Notice } from "@/components/ui";
import { getMessages } from "@/i18n";
import { services } from "@/lib/server";

// Rendering verifies the token (one-time, 7 days). Link scanners consuming it only confirm the address early.
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getMessages();
  let ok = true;
  try {
    await verifyEmail(services().db, token);
  } catch (e) {
    if (!isAppError(e)) throw e;
    ok = false;
  }
  return (
    <>
      <h2 className="mb-6 text-3xl font-bold">{t.team.emailVerify}</h2>
      <Notice tone={ok ? "ok" : "bad"}>{ok ? t.auth.verified : t.auth.tokenInvalid}</Notice>
      <Link href="/app" className="btn btn-primary mt-6">
        {t.nav.dashboard}
      </Link>
    </>
  );
}
