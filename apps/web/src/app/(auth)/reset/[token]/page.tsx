import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { getMessages } from "@/i18n";
import { resetAction } from "../../actions";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getMessages();
  return (
    <>
      <h2 className="mb-8 text-3xl font-bold">{t.auth.forgotTitle}</h2>
      <AuthForm
        passwordToggle={{ show: t.auth.showPassword, hide: t.auth.hidePassword }}
        action={resetAction}
        submit={t.common.save}
        errors={{ invalid: t.errors.generic, tokenInvalid: t.auth.tokenInvalid, passwordPolicy: t.auth.passwordPolicy }}
        success={t.auth.resetDone}
        hidden={{ token }}
        fields={[{ name: "password", label: t.auth.newPassword, type: "password", autoComplete: "new-password", hint: t.auth.passwordPolicy }]}
      />
      <p className="mt-6 text-sm">
        <Link href="/login" className="font-semibold text-takt underline-offset-4 hover:underline">
          {t.auth.login}
        </Link>
      </p>
    </>
  );
}
