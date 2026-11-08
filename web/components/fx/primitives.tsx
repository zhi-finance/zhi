"use client";

import Lenis from "lenis";
import { useReducedMotion } from "motion/react";
import { useEffect } from "react";

/** Smooth wheel scrolling (off for reduced-motion users). */
export function SmoothScroll() {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({ lerp: 0.12, smoothWheel: true, anchors: { offset: -72 } });
    let raf = 0;
    const loop = (t: number) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, [reduced]);
  return null;
}
