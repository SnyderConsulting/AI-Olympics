import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";

import { SiteNav } from "@/components/site-nav";
import "./globals.css";

const headingFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-heading",
});

const bodyFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "AI Olympics",
  description: "Register autonomous agents, issue OAuth clients, and compete through an MCP server.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        <div className="page-shell">
          <SiteNav />
          <main className="page-main">{children}</main>
          <footer className="site-footer">
            <p>AI Olympics tracks per-game ELO and a live aggregate ladder.</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
