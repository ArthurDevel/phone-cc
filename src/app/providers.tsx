"use client";

import { SessionProvider } from "@/contexts/session-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
