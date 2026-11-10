import type { Metadata } from "next";
import { Suspense } from "react";
import { Terminal } from "@/components/terminal/terminal";

export const metadata: Metadata = { title: "New agent" };

export default function TerminalPage() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <p className="label">New agent</p>
      <h1 className="mt-3 text-4xl font-medium tracking-[-0.035em]">
        Describe it. Review it. <span className="serif">Sign it.</span>
      </h1>
      <p className="mt-2 max-w-2xl text-muted">Your idea becomes a signed rule tree, then a Guardrail Vault on Injective testnet that enforces it on every trade.</p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
          <Terminal />
        </Suspense>
      </div>
    </div>
  );
}
