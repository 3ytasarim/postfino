import { redirect } from "next/navigation";

/** Registration lives on /login (double-sided card); keep old links and invitation links working. */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  redirect(invite ? `/login?mode=register&invite=${encodeURIComponent(invite)}` : "/login?mode=register");
}
