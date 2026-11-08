import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-foreground text-background hover:opacity-85",
  secondary: "border border-border-strong text-foreground hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-foreground",
  danger: "bg-seal text-white hover:opacity-90",
};

export function Button({ variant = "primary", className, loading, children, disabled, ...p }: ComponentProps<"button"> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-[background-color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-35",
        focus,
        variants[variant],
        className,
      )}
    >
      {loading && <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...p} className={cx("inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-opacity duration-150", focus, variants[variant], className)} />;
}

export function Card({ className, ...p }: ComponentProps<"section">) {
  return <section {...p} className={cx("overflow-hidden rounded-2xl border border-border bg-surface", className)} />;
}

export function CardHeader({ title, action, desc }: { title: ReactNode; action?: ReactNode; desc?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-medium tracking-tight">{title}</h2>
        {desc && <p className="mt-1 text-[13px] leading-relaxed text-muted">{desc}</p>}
      </div>
      {action}
    </header>
  );
}

type Tone = "neutral" | "accent" | "warn" | "danger";
const tones: Record<Tone, string> = {
  neutral: "border-border-strong text-muted",
  accent: "border-ok/40 text-ok",
  warn: "border-warn/40 text-warn",
  danger: "border-seal/50 text-seal",
};

export function Badge({ tone = "neutral", className, ...p }: ComponentProps<"span"> & { tone?: Tone }) {
  return <span {...p} className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[11px] leading-4 uppercase tracking-wider", tones[tone], className)} />;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className={cx("mt-2 truncate font-mono text-xl tracking-tight tabular", tone === "danger" && "text-seal", tone === "accent" && "text-ok", tone === "warn" && "text-warn")}>{value}</dd>
      {hint && <dd className="mt-1 text-xs text-muted">{hint}</dd>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("block animate-pulse rounded-lg bg-surface-2 motion-reduce:animate-none", className)} />;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBox({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-seal/40 bg-seal-soft px-4 py-3 text-sm text-foreground">
      <span className="min-w-0 break-words"><span className="mr-2 font-mono text-xs text-seal">ERROR</span>{children}</span>
      {onRetry && (
        <button onClick={onRetry} className={cx("shrink-0 rounded px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline", focus)}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="label block">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-seal">{error}</p> : hint ? <p className="text-xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputCls = cx(
  "block w-full rounded-lg border border-border-strong bg-background px-3.5 py-2.5 text-sm placeholder:text-faint transition-colors focus:border-foreground/50 focus:outline-none",
);

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono tabular", className)}>{children}</span>;
}
