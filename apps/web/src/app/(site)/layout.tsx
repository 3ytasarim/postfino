import Link from "next/link";
import { Logo } from "@/components/logo";
import { getMessages } from "@/i18n";

// Public, indexable site pages (developer portal, status). No session required.
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getMessages();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Link href="/" aria-label="Postfino">
            <Logo />
          </Link>
          <nav className="flex gap-1 text-sm font-medium" aria-label="Site">
            <Link href="/developers" className="rounded-[10px] px-3 py-2 text-ink-2 hover:bg-surface-2 hover:text-ink">
              {t.devPortal.title}
            </Link>
            <Link href="/status" className="rounded-[10px] px-3 py-2 text-ink-2 hover:bg-surface-2 hover:text-ink">
              {t.statusPage.title}
            </Link>
          </nav>
          <Link href="/login" className="btn btn-ghost ml-auto !min-h-[40px]">
            {t.auth.login}
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-12">
        {children}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-ink-3">Postfino — {t.brand.by}</footer>
    </div>
  );
}
