import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "YouTube Trend Radar",
  description: "A weekly, evidence-backed Sunday content brief for Ishaan's tech channel.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={geistSans.variable}>
        <header className="site-header">
          <nav>
            <Link href="/" className="brand">
              Trend <span>Radar</span>
            </Link>
            <Link href="/">This week</Link>
            <Link href="/archive">Archive</Link>
            <Link href="/runs">Runs</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
