import type { Metadata } from "next";
import { MyAgents } from "@/components/my-agents";

export const metadata: Metadata = { title: "My agents" };

export default function PortfolioPage() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <p className="label">My agents</p>
      <h1 className="mt-3 text-[clamp(2.4rem,5vw,4rem)] font-medium tracking-[-0.04em]">
        Your vaults. <span className="serif text-muted">Your limits.</span>
      </h1>
      <div className="mt-8">
        <MyAgents />
      </div>
    </div>
  );
}
