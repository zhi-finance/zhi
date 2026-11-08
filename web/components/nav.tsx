"use client";

import { ArrowUpRight, Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ConnectButton } from "./connect-button";
import { SealMark } from "./fx/seal-mark";

export const isAppPath = (p: string) => ["/markets", "/terminal", "/agents", "/portfolio"].some((x) => p.startsWith(x));

const links = [
  { href: "/#how", label: "How it works" },
  { href: "/#playground", label: "Playground" },
  { href: "/agents", label: "Agents" },
  { href: "/docs", label: "Docs" },
];

export function Nav() {
  const path = usePathname();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === path; // closes automatically on navigation
  if (isAppPath(path)) return null;

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-5">
        <Link href="/" className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <SealMark size={26} />
          <span className="text-[17px] font-semibold tracking-tight">Zhi</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-4 sm:flex">
          <span className="label hidden items-center gap-2 lg:flex">
            <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-ok" /> Injective testnet
          </span>
          {(
            <Link
              href="/markets"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Launch app <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
        <button
          className="ml-auto grid size-10 place-items-center rounded-full hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:ml-0 md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpenFor(open ? null : path)}
        >
          {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav aria-label="Mobile" initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-border md:hidden">
            <div className="px-5 py-3">
              {[...links, { href: "/markets", label: "Launch app" }].map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setOpenFor(null)} className="block py-3 text-base">
                  {l.label}
                </Link>
              ))}
              <div className="py-3">
                <ConnectButton />
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
