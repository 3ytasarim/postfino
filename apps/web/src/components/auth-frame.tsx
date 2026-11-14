"use client";
import { usePathname } from "next/navigation";

/** /login renders its own double card; every other auth page (forgot, 2FA, reset, onboarding …) gets one glass card. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/login") return <>{children}</>;
  return <div className="auth-card w-full max-w-md rounded-[26px] p-6 sm:p-8">{children}</div>;
}
