import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Interview Platform",
    template: "%s · Interview Platform",
  },
  description: "AI Recruiter platform",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
