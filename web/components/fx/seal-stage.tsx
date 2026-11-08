"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { SealMark } from "./seal-mark";

const SealScene = dynamic(() => import("./seal-scene"), { ssr: false, loading: () => <Fallback /> });

function Fallback() {
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center">
      <SealMark size={180} className="opacity-90" />
    </div>
  );
}

/** Mounts the WebGL seal only while visible. `progress` (0..1) drives the stamp motion. */
export function SealStage({ className, progress = 0 }: { className?: string; progress?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const stamp = useRef(0);
  const [visible, setVisible] = useState(true);
  const [webgl] = useState(() => {
    if (typeof document === "undefined") return true;
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  });

  useEffect(() => {
    stamp.current = progress;
  }, [progress]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {webgl ? <SealScene paused={!visible} stamp={stamp} /> : <Fallback />}
    </div>
  );
}
