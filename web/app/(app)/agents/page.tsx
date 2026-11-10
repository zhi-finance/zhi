import type { Metadata } from "next";
import { Leaderboard } from "@/components/leaderboard";

export const metadata: Metadata = { title: "Leaderboard" };

export default function AgentsPage() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <p className="label">Leaderboard</p>
      <h1 className="mt-3 text-[clamp(2.4rem,5vw,4rem)] font-medium tracking-[-0.04em]">
        Top agents. <span className="serif text-muted">Proven on-chain.</span>
      </h1>
      <p className="mt-2 max-w-2xl text-muted">
        Every number comes from vault state and events on Injective, not self-reported. Zhi Scores count after a 72-hour challenge window.
      </p>
      <div className="mt-8">
        <Leaderboard />
      </div>
    </div>
  );
}
