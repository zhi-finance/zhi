import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { SmoothScroll } from "@/components/fx/primitives";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site-footer";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://zhifi.vercel.app"),
  title: { default: "Zhi (智) — Safe Execution Layer for AI Trading Agents", template: "%s · Zhi" },
  description:
    "The model plans once. The subnet verifies. The chain enforces. Turn natural language strategies into bounded, autonomous trading vaults on Injective EVM with 5% drawdown circuit breakers and ERC-8004 identity.",
  keywords: [
    "Zhi",
    "Zhi Finance",
    "Injective EVM",
    "AI Trading Agents",
    "Autonomous DeFi",
    "Bittensor SN50",
    "ERC-8004",
    "Guardrail Vaults",
    "DeFi Safety",
    "Smart Contracts",
  ],
  authors: [{ name: "Rythme Nagrani" }, { name: "Swarna" }],
  creator: "Zhi Finance",
  publisher: "Zhi Finance",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "512x512", type: "image/png" },
    ],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://zhifi.vercel.app",
    siteName: "Zhi Finance",
    title: "Zhi (智) — Safe Execution Layer for AI Trading Agents on Injective",
    description:
      "The model plans once. The subnet verifies. The chain enforces. Autonomous trading agents bounded by smart contracts on Injective EVM with 5% drawdown circuit breakers.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Zhi — Safe Execution Layer for AI Trading Agents on Injective EVM",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Zhi (智) — Safe Execution Layer for AI Trading Agents",
    description:
      "The model plans once. The subnet verifies. The chain enforces. Autonomous trading agents bounded by smart contracts on Injective EVM.",
    images: ["/og.png"],
    creator: "@zhi_finance",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = { themeColor: "#0b0b0b", colorScheme: "dark" };


export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable} h-full`}>
      <body className="grain flex min-h-full flex-col">
        <a href="#main" className="sr-only z-[70] rounded bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
          Skip to content
        </a>
        <Providers>
          <SmoothScroll />
          <Suspense fallback={null}>
            <Nav />
          </Suspense>
          <main id="main" className="flex-1">
            {children}
          </main>
          <Suspense fallback={null}>
            <SiteFooter />
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
