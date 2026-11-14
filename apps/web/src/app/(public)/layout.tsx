// Client-facing pages (review portal). Header/footer are rendered by the page so white-label can replace them.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh">{children}</div>;
}
