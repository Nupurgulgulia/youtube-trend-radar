import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "600", "700"] });

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
      <body className={`${jakarta.variable} ${jetbrains.variable}`}>
        <header className="site-header">
          <nav>
            <Link href="/" className="brand">
              <span className="brand-play" aria-hidden>
                <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              </span>
              YouTube Trend Radar
              <span className="brand-tag">P13</span>
            </Link>
            <Link href="/">This week</Link>
            <Link href="/archive">Archive</Link>
            <Link href="/research">Research</Link>
            <Link href="/runs">Runs</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
