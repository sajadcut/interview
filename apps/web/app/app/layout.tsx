import type { ReactNode } from "react";
import { InternalAccessGate } from "../../components/product/internal-access";
import { AppShell } from "../../components/product/app-shell";

export default function InternalLayout({ children }: { children: ReactNode }) {
  return (
    <InternalAccessGate>
      <AppShell>{children}</AppShell>
    </InternalAccessGate>
  );
}
