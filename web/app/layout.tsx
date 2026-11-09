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
  title: { default: "Zhi — trading agents bound by the chain", template: "%s · Zhi" },
  description:
    "The model plans once. The subnet verifies. The chain enforces. Turn a trading idea into a signed rule tree, gate every entry on Bittensor Synth (SN50), and trade Injective's orderbook through an on-chain Guardrail Vault.",
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
