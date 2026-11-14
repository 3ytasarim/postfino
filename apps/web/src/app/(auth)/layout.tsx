import Link from "next/link";
import { Logo } from "@/components/logo";
import { AuthFrame } from "@/components/auth-frame";
import { getMessages } from "@/i18n";

/** Auth area: always the dark glass look on an animated cobalt aurora, brand wordmark centred above the card. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getMessages();
  return (
    <div data-theme="dark" className="auth-root relative min-h-dvh overflow-hidden text-ink">
      <div className="aurora" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="relative z-[1] flex min-h-dvh flex-col items-center px-4 py-8 sm:py-10">
        <Link href="/" aria-label="Postfino" className="rise mb-7 sm:mb-9">
          <Logo size={46} />
        </Link>
        <main className="rise flex w-full flex-1 items-start justify-center sm:items-center">
          <AuthFrame>{children}</AuthFrame>
        </main>
        <p className="mt-8 text-xs text-white/45">
          Postfino — {t.brand.by}
        </p>
      </div>
    </div>
  );
}
