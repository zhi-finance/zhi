"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SealMark } from "./fx/seal-mark";
import { isAppPath } from "./nav";

const FOOT = [
  { t: "Product", l: [["Launch app", "/terminal"], ["Pitch deck", "/pitch"], ["Live agents", "/agents"], ["Playground", "/#playground"], ["Docs", "/docs"]] },
  { t: "Network", l: [["Injective testnet faucet", "https://testnet.faucet.injective.network"], ["Block explorer", "https://testnet.blockscout.injective.network"], ["Synth · SN50", "https://synthdata.co"]] },
  { t: "Standards", l: [["ERC-8004", "https://eips.ethereum.org/EIPS/eip-8004"], ["Injective precompiles", "https://github.com/InjectiveLabs/solidity-contracts"]] },
];

export function SiteFooter() {
  const path = usePathname();
  if (isAppPath(path)) return null;
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <SealMark size={26} />
            <span className="text-[17px] font-semibold tracking-tight">Zhi</span>
          </div>
          <p className="mt-4 max-w-xs text-sm text-muted">
            The model plans once. The subnet verifies. <span className="serif text-foreground">The chain enforces.</span>
          </p>
        </div>
        {FOOT.map((c) => (
          <div key={c.t}>
            <p className="label">{c.t}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {c.l.map(([label, href]) => (
                <li key={label}>
                  {href.startsWith("/") ? (
                    <Link className="text-muted hover:text-foreground" href={href}>{label}</Link>
                  ) : (
                    <a className="text-muted hover:text-foreground" href={href} target="_blank" rel="noreferrer">{label}</a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 border-t border-border px-5 py-5 text-xs text-faint">
        <span>Testnet software, unaudited. Not investment advice.</span>
        <span>Synth forecasts filter entries; they don&apos;t make trades profitable.</span>
      </div>
    </footer>
  );
}
