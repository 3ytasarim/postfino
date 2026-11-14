import { LiquidOtp } from "@/components/liquid-otp";
import { getMessages } from "@/i18n";
import { twoFactorAction } from "../../actions";

export default async function TwoFactorPage() {
  const { t } = await getMessages();
  return (
    <div className="text-center">
      <h1 className="font-display text-2xl font-bold text-white">{t.auth.twoFactor}</h1>
      <p className="mt-2 mb-7 text-sm text-white/80">{t.auth.twoFactorHint}</p>
      <LiquidOtp action={twoFactorAction} label={t.auth.twoFactor} hint={t.palette.otpHint} errors={{ invalid: t.palette.otpInvalid }} verifying={t.palette.otpVerifying} done={t.palette.otpDone} />
    </div>
  );
}
