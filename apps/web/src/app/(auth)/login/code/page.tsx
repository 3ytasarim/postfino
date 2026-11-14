import Link from "next/link";
import { cookies } from "next/headers";
import { MailCheck } from "lucide-react";
import { describeLoginChallenge } from "@sichttakt/core";
import { LiquidOtp } from "@/components/liquid-otp";
import { CodeResend } from "@/components/code-resend";
import { getMessages } from "@/i18n";
import { services, currentSession } from "@/lib/server";
import { CHALLENGE_COOKIE, DEV_CODE_COOKIE } from "@/lib/email-challenge";
import { resendLoginCodeAction, verifyLoginCodeAction } from "../../actions-social";

export const metadata = { title: "Code bestätigen" };

/** Email code step: shown after sign-up (and for sign-ins of accounts whose email is not confirmed yet). */
export default async function CodePage() {
  const { t } = await getMessages();
  const c = t.codeStep;
  const jar = await cookies();
  const info = await describeLoginChallenge(services().db, jar.get(CHALLENGE_COOKIE)?.value);
  const devCode = jar.get(DEV_CODE_COOKIE)?.value;
  // Right after a correct code the action refreshes this route: the challenge is consumed but a session exists.
  // Keep rendering the same tree so the success animation and its redirect finish instead of flashing "expired".
  const justVerified = !info && Boolean(await currentSession());

  if (!info && !justVerified)
    return (
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold text-white">{c.expiredTitle}</h1>
        <p className="mt-2 text-sm text-white/75">{c.expiredBody}</p>
        <Link href="/login" className="btn btn-primary mt-6 w-full justify-center">
          {t.auth.login}
        </Link>
      </div>
    );

  return (
    <div className="flex flex-col items-center text-center">
      <span className="code-mail mb-4 grid size-16 place-items-center rounded-full bg-white/20 ring-1 ring-white/40">
        <MailCheck className="size-8 text-white" />
      </span>
      <h1 className="font-display text-2xl font-bold text-white">{c.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-white/80">
        {c.sentTo} <strong className="text-white">{info?.email ?? "…"}</strong>
      </p>
      {devCode && info && (
        <p className="mt-3 rounded-[12px] border border-dashed border-white/50 bg-white/10 px-3 py-2 text-xs text-white">
          <span className="mr-1.5 rounded bg-white px-1.5 py-0.5 font-bold text-[#1d5bd8]">DEV</span>
          {c.devNoSmtp} <strong className="font-mono tracking-[0.2em]">{devCode}</strong>
        </p>
      )}
      <div className="mt-7 w-full">
        <LiquidOtp action={verifyLoginCodeAction} label={c.label} hint={c.hint} errors={{ invalid: c.invalid, locked: c.locked, expired: c.expiredBody }} verifying={c.verifying} done={c.done} next="/onboarding" />
      </div>
      <div className="mt-2">
        <CodeResend action={resendLoginCodeAction} resendAt={(info?.resendAt ?? new Date(Date.now() + 864e5)).toISOString()} l={{ resend: c.resend, resendIn: c.resendIn, sent: c.resent, tooSoon: c.tooSoon }} />
      </div>
      <Link href="/login" className="mt-5 text-xs text-white/60 underline-offset-4 hover:text-white hover:underline">
        {c.back}
      </Link>
    </div>
  );
}
