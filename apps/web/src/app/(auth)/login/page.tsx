import Link from "next/link";
import { getInvite } from "@sichttakt/core";
import { AuthForm } from "@/components/auth-form";
import { AuthSwitch } from "@/components/auth-switch";
import { getMessages } from "@/i18n";
import { services } from "@/lib/server";
import { loginAction, registerAction } from "../actions";

export const metadata = { title: "Anmelden" };

/** One route for both: /login (sign in) and /login?mode=register (create account); invitations keep working. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string; invite?: string; deleted?: string }> }) {
  const { next, mode, invite, deleted } = await searchParams;
  const { t } = await getMessages();
  // Invited users: the email is taken from the invitation (server-side), never from the URL.
  const inv = invite ? await getInvite(services().db, invite) : null;
  const a = t.auth;

  const loginForm = (
    <>
      {deleted === "1" && (
        <p role="status" className="mb-4 rounded-xl bg-white/10 px-4 py-3 text-sm text-white/90">
          {t.accountDelete.deleted}
        </p>
      )}
      <AuthForm
        passwordToggle={{ show: a.showPassword, hide: a.hidePassword }}
        action={loginAction}
        submit={a.login}
        errors={{ invalid: a.invalid, locked: a.locked }}
        hidden={next ? { next } : {}}
        fields={[
          { name: "email", label: a.email, type: "email", autoComplete: "email" },
          { name: "password", label: a.password, type: "password", autoComplete: "current-password" },
        ]}
      />
      <p className="mt-4 text-right text-sm">
        <Link href="/forgot" className="font-medium text-white/70 underline-offset-4 hover:text-white hover:underline">
          {a.forgot}
        </Link>
      </p>
    </>
  );
  const registerForm = (
    <>
      <AuthForm
        passwordToggle={{ show: a.showPassword, hide: a.hidePassword }}
        action={registerAction}
        submit={a.register}
        errors={{ invalid: a.invalid, emailTaken: a.emailTaken, passwordPolicy: a.passwordPolicy }}
        hidden={inv && invite ? { invite } : {}}
        fields={[
          { name: "name", label: a.name, autoComplete: "name" },
          { name: "email", label: a.email, type: "email", autoComplete: "email", defaultValue: inv?.email },
          { name: "password", label: a.password, type: "password", autoComplete: "new-password", hint: a.passwordPolicy },
        ]}
      />
      <p className="mt-3 text-[0.7rem] leading-relaxed text-white/50">{a.consent}</p>
    </>
  );

  return (
    <AuthSwitch
      initial={mode === "register" || invite ? "register" : "login"}
      t={{ login: a.login, register: a.register, welcomeTitle: a.welcome, welcomeSub: a.welcomeSub, registerTitle: a.register, ...t.authSwitch }}
      loginForm={loginForm}
      registerForm={registerForm}
    />
  );
}
