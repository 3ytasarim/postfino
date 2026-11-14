import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getMessages } from "@/i18n";
import { currentSession } from "@/lib/server";
import { onboardingAction } from "../actions";

const ZONES = ["Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/Istanbul", "Europe/London", "UTC"];

export default async function OnboardingPage() {
  if (!(await currentSession())) redirect("/login");
  const { t } = await getMessages();
  return (
    <>
      <h2 className="mb-8 text-3xl font-bold">{t.onboarding.title}</h2>
      <AuthForm
        action={onboardingAction}
        submit={t.onboarding.submit}
        errors={{ invalid: t.errors.generic }}
        fields={[
          { name: "org", label: t.onboarding.org, autoComplete: "organization" },
          { name: "workspace", label: t.onboarding.workspace },
          { name: "timezone", label: t.onboarding.timezone, options: ZONES, defaultValue: "Europe/Berlin" },
        ]}
      />
    </>
  );
}
