import { cookies } from "next/headers";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { TotpSetup } from "@/components/totp-setup";
import { ResendVerification } from "@/components/resend-verification";
import { getMessages } from "@/i18n";
import { requireContext } from "@/lib/server";
import { getBrandVoice, planAccountDeletion } from "@sichttakt/core";
import { DeleteAccount } from "@/components/delete-account";
import { FormAction } from "@/components/form-action";
import { saveBrandVoiceAction, updateWorkspaceAction } from "../actions-content";
import { setPreferenceAction } from "../actions";

export const metadata = { title: "Einstellungen" };

export default async function SettingsPage() {
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const theme = (await cookies()).get("st_theme")?.value ?? "system";
  const voice = await getBrandVoice(ctx.svc.db, ctx.actor, ctx.workspace.id);
  const deletion = await planAccountDeletion(ctx.svc.db, ctx.user.id);
  return (
    <>
      <PageHeader title={t.settings.title} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-4 text-lg font-bold">{t.settings.profile}</h2>
          <form action={setPreferenceAction} className="space-y-4">
            <div>
              <label className="label" htmlFor="locale">
                {t.common.language}
              </label>
              <select id="locale" name="locale" defaultValue={locale} className="input">
                <option value="de">Deutsch</option>
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="theme">
                {t.common.theme}
              </label>
              <select id="theme" name="theme" defaultValue={theme} className="input">
                <option value="system">{t.common.system}</option>
                <option value="light">{t.common.light}</option>
                <option value="dark">{t.common.dark}</option>
              </select>
            </div>
            <button className="btn btn-primary">{t.common.save}</button>
          </form>
        </section>
        <section className="card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <ShieldCheck className="size-5" /> {t.settings.twoFactor}
          </h2>
          {ctx.user.totpEnabledAt ? <p className="chip bg-ok-soft text-ok">{t.settings.twoFactorOn}</p> : <TotpSetup t={t.settings} />}
          <h2 className="mt-8 mb-3 text-lg font-bold">{t.team.emailVerify}</h2>
          <p className="mb-3 text-sm text-ink-2">
            {ctx.user.email} · <span className={ctx.user.emailVerifiedAt ? "text-ok" : "text-warn"}>{ctx.user.emailVerifiedAt ? t.team.verifiedYes : t.team.verifiedNo}</span>
          </p>
          {!ctx.user.emailVerifiedAt && <ResendVerification label={t.team.resend} sent={t.auth.forgotSent} notDelivered={`SMTP: ${t.common.notConfigured}`} />}
        </section>
      </div>
      <section className="card mt-6 p-6">
        <h2 className="mb-4 text-lg font-bold">
          {t.nav.workspace}: {ctx.workspace.name}
        </h2>
        <FormAction action={updateWorkspaceAction} submit={t.common.save} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-ink-2">
            Name
            <input name="name" defaultValue={ctx.workspace.name} className="input mt-1" />
          </label>
          <label className="text-sm font-semibold text-ink-2">
            {t.onboarding.timezone}
            <select name="timezone" defaultValue={ctx.workspace.timezone} className="input mt-1">
              {["Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/Istanbul", "Europe/London", "UTC"].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-2 sm:col-span-2">
            <input type="checkbox" name="approvalRequired" defaultChecked={ctx.workspace.approvalRequired} className="size-4 accent-[var(--takt)]" />
            {t.publish.approvals}: {t.post.submitApproval} → {t.post.approve}
          </label>
        </FormAction>
      </section>
      <section className="card mt-6 p-6">
        <h2 className="mb-1 text-lg font-bold">
          {t.brandVoice.title} · {ctx.workspace.name}
        </h2>
        <p className="mb-4 text-sm text-ink-2">{t.ai.title}</p>
        <FormAction action={saveBrandVoiceAction} submit={t.common.save} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-ink-2 sm:col-span-2">
            {t.brandVoice.description}
            <textarea name="description" rows={3} defaultValue={voice?.description ?? ""} className="input mt-1" />
          </label>
          <label className="text-sm font-semibold text-ink-2">
            {t.brandVoice.dos}
            <textarea name="dos" rows={4} defaultValue={voice?.dos.join("\n") ?? ""} className="input mt-1" />
          </label>
          <label className="text-sm font-semibold text-ink-2">
            {t.brandVoice.donts}
            <textarea name="donts" rows={4} defaultValue={voice?.donts.join("\n") ?? ""} className="input mt-1" />
          </label>
          <label className="text-sm font-semibold text-ink-2 sm:col-span-2">
            {t.brandVoice.examples}
            <textarea name="examples" rows={4} defaultValue={voice?.examples.join("\n") ?? ""} className="input mt-1" />
          </label>
          <label className="text-sm font-semibold text-ink-2">
            {t.brandVoice.language}
            <select name="language" defaultValue={voice?.language ?? "de"} className="input mt-1">
              <option value="de">Deutsch</option>
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
            </select>
          </label>
        </FormAction>
      </section>
      <section id="konto-loeschen" className="card mt-6 border border-bad/30 p-6">
        <h2 className="mb-3 text-lg font-bold text-bad">{t.accountDelete.title}</h2>
        <DeleteAccount t={t.accountDelete} plan={deletion} hasPassword={Boolean(ctx.user.passwordHash)} />
      </section>
    </>
  );
}
