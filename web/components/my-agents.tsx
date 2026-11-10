"use client";

import { useConnection } from "wagmi";
import { ConnectButton } from "./connect-button";
import { Leaderboard } from "./leaderboard";

export function MyAgents() {
  const c = useConnection();
  if (!c.address) {
    return (
      <div className="rounded-2xl border border-border px-6 py-16 text-center">
        <p className="font-medium">Connect a wallet to see agents you operate.</p>
        <p className="mt-1 text-sm text-muted">Any EVM wallet on Injective testnet (chain 1439) works.</p>
        <div className="mt-5 inline-block">
          <ConnectButton />
        </div>
      </div>
    );
  }
  return <Leaderboard operator={c.address} />;
}
