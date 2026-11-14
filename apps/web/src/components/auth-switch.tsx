"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight } from "lucide-react";

export type AuthSwitchTexts = { login: string; register: string; welcomeTitle: string; welcomeSub: string; registerTitle: string; newHere: string; newHereSub: string; createAccount: string; haveAccountTitle: string; haveAccountSub: string; toLogin: string };

/**
 * Double-sided glass auth card (one route, /login): login form on the left, registration on the right. A skewed
 * frosted panel sweeps across to cover the inactive form and carries the "switch" call-to-action; forms cross-fade.
 * The URL follows the mode (?mode=register) without a navigation. Phones get a simple tab switch instead.
 */
export function AuthSwitch({ initial, t, loginForm, registerForm }: { initial: "login" | "register"; t: AuthSwitchTexts; loginForm: React.ReactNode; registerForm: React.ReactNode }) {
  const [mode, setMode] = useState(initial);
  const go = (m: "login" | "register") => {
    setMode(m);
    const u = new URL(window.location.href);
    if (m === "register") u.searchParams.set("mode", "register");
    else u.searchParams.delete("mode");
    window.history.replaceState(null, "", u.toString());
  };
  const isLogin = mode === "login";

  const welcome = (side: "login" | "register") => {
    const forLogin = side === "login"; // shown while the login form is active → invites to register
    return (
      <div className="flex h-full flex-col justify-center">
        <p className="font-display text-[1.9rem] leading-[1.1] font-extrabold tracking-tight text-white">{forLogin ? t.newHere : t.haveAccountTitle}</p>
        <p className="mt-3 max-w-[30ch] text-sm leading-relaxed text-white/70">{forLogin ? t.newHereSub : t.haveAccountSub}</p>
        <button onClick={() => go(forLogin ? "register" : "login")} className="group mt-6 inline-flex w-fit items-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-white hover:text-[#0e0f12]">
          {forLogin ? t.createAccount : t.toLogin}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mascots-960.webp" alt="" className="auth-mascot mt-6 w-full max-w-[340px] mix-blend-lighten" />
      </div>
    );
  };

  return (
    <>
      {/* ── desktop: sweeping double card ── */}
      <div className={`auth-card relative hidden h-[600px] w-full max-w-[980px] overflow-hidden rounded-[28px] md:block ${isLogin ? "is-login" : "is-register"}`}>
        <div className="auth-sweep" aria-hidden />
        <section className={`auth-pane left-0 ${isLogin ? "is-on" : "is-off-l"}`} aria-hidden={!isLogin} inert={!isLogin}>
          <div className="w-full max-w-[340px]">
            <h1 className="mb-1 font-display text-2xl font-bold text-white">{t.login}</h1>
            <p className="mb-6 text-sm text-white/60">{t.welcomeSub}</p>
            {loginForm}
          </div>
        </section>
        <section className={`auth-pane right-0 ${!isLogin ? "is-on" : "is-off-r"}`} aria-hidden={isLogin} inert={isLogin}>
          <div className="w-full max-w-[340px]">
            <h1 className="mb-6 font-display text-2xl font-bold text-white">{t.registerTitle}</h1>
            {registerForm}
          </div>
        </section>
        <aside className={`auth-welcome right-0 pl-20 ${isLogin ? "is-on" : "is-off-r"}`} aria-hidden={!isLogin}>
          {welcome("login")}
        </aside>
        <aside className={`auth-welcome left-0 pr-20 ${!isLogin ? "is-on" : "is-off-l"}`} aria-hidden={isLogin}>
          {welcome("register")}
        </aside>
      </div>

      {/* ── phones: tabs ── */}
      <div className="auth-card w-full max-w-md rounded-[26px] p-5 md:hidden">
        <div className="relative mb-5 grid grid-cols-2 rounded-full bg-white/10 p-1" role="tablist">
          {(["login", "register"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => go(m)} className={`relative z-[1] rounded-full py-2 text-sm font-semibold transition-colors ${mode === m ? "text-[#0e0f12]" : "text-white/70"}`}>
              {mode === m && <motion.span layoutId="auth-tab" className="absolute inset-0 -z-[1] rounded-full bg-white" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              {m === "login" ? t.login : t.register}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={mode} initial={{ opacity: 0, x: isLogin ? -16 : 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
            {isLogin ? loginForm : registerForm}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
}
