import { ZHI_BBOX, ZHI_PATH } from "@/lib/glyph";

/** The Zhi seal: 智 knocked out of a vermilion square, like a name chop (朱印). */
export function SealMark({ size = 28, className, ink = "var(--seal)", paper = "var(--background)", rough = false }: { size?: number; className?: string; ink?: string; paper?: string; rough?: boolean }) {
  const pad = 150;
  const w = ZHI_BBOX.x2 - ZHI_BBOX.x1;
  const h = ZHI_BBOX.y2 - ZHI_BBOX.y1;
  const side = Math.max(w, h) + pad * 2;
  const ox = ZHI_BBOX.x1 - (side - w) / 2;
  const oy = ZHI_BBOX.y1 - (side - h) / 2;
  return (
    <svg width={size} height={size} viewBox={`${ox} ${oy} ${side} ${side}`} className={className} aria-hidden>
      {rough && (
        <filter id="seal-rough">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="22" />
        </filter>
      )}
      <g filter={rough ? "url(#seal-rough)" : undefined}>
        <rect x={ox + 30} y={oy + 30} width={side - 60} height={side - 60} rx={side * 0.08} fill={ink} />
        <path d={ZHI_PATH} fill={paper} />
      </g>
    </svg>
  );
}
