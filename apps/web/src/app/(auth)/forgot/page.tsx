import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { getMessages } from "@/i18n";
import { forgotAction } from "../actions";

export const metadata = { title: "Passwort zurücksetzen" };

export default async function ForgotPage() {
  const { t } = await getMessages();
  return (
    <>
      <h2 className="mb-8 text-3xl font-bold">{t.auth.forgotTitle}</h2>
      <AuthForm action={forgotAction} submit={t.auth.sendLink} errors={{ invalid: t.errors.generic }} success={t.auth.forgotSent} fields={[{ name: "email", label: t.auth.email, type: "email", autoComplete: "email" }]} />
      <p className="mt-6 text-sm">
        <Link href="/login" className="font-semibold text-takt underline-offset-4 hover:underline">
          {t.common.back}
        </Link>
      </p>
    </>
  );
}
