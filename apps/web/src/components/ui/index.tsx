import { AlertTriangle, Info, Loader2, RotateCw, type LucideIcon } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Link, type LinkProps } from "react-router";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── Buttons ────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg shadow-card hover:opacity-95 active:opacity-90",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2",
  ghost: "text-primary hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-95",
};
const buttonBase =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; block?: boolean }>(
  function Button({ variant = "primary", loading, block, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cx(buttonBase, variants[variant], block && "w-full", className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading && <Loader2 aria-hidden className="size-5 animate-spin" />}
        {children}
      </button>
    );
  },
);

export function ButtonLink({ variant = "primary", block, className, ...rest }: LinkProps & { variant?: Variant; block?: boolean }) {
  return <Link className={cx(buttonBase, variants[variant], block && "w-full", className)} {...rest} />;
}

// ── Form fields ────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-text">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { invalid, className, id, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={id ? (invalid ? `${id}-error` : `${id}-hint`) : undefined}
      className={cx(
        "min-h-12 w-full rounded-xl border bg-surface px-4 text-base text-text placeholder:text-muted/70",
        invalid ? "border-danger" : "border-border",
        className,
      )}
      {...rest}
    />
  );
});

/** Single-choice segmented control (radio group semantics). */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  error,
  name,
}: {
  label: string;
  value: T | undefined;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  error?: string;
  name: string;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-1.5 text-sm font-semibold text-text">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={cx(
                "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--focus)]",
                checked ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-text hover:bg-surface-2",
              )}
            >
              <input type="radio" className="sr-only" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} />
              {o.label}
            </label>
          );
        })}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function Switch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div>
        <label htmlFor={id} className="text-sm font-semibold text-text">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="text-sm text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition", checked ? "bg-primary" : "bg-surface-2 ring-1 ring-border")}
      >
        <span className={cx("absolute top-1 size-6 rounded-full bg-white shadow transition-all", checked ? "left-7" : "left-1")} />
      </button>
    </div>
  );
}

// ── Surfaces & states ─────────────────────────────────────────────

export function Card({ className, children, as: As = "div" }: { className?: string; children: ReactNode; as?: "div" | "section" | "li" | "article" }) {
  return <As className={cx("rounded-3xl border border-border bg-surface p-5 shadow-card", className)}>{children}</As>;
}

export function Banner({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children: ReactNode }) {
  const styles = {
    info: "bg-surface-2 text-text",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
  }[tone];
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex gap-3 rounded-2xl p-4 text-sm", styles)}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "mt-0.5" : undefined}>{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-muted">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      <span>{label}…</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-2xl bg-surface-2", className)} />;
}

export function ListSkeleton({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-primary">
        <Icon aria-hidden className="size-7" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-2 w-full max-w-xs">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-3xl bg-danger-soft px-6 py-8 text-center text-danger">
      <AlertTriangle aria-hidden className="size-7" />
      <p className="font-medium">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <RotateCw aria-hidden className="size-4" /> Try again
        </Button>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** Native <dialog> confirm: focus-trapped and Escape-closable by the browser. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = "danger",
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(92vw,26rem)] rounded-3xl border border-border bg-surface p-0 text-text shadow-card backdrop:bg-black/50"
    >
      {open && (
        <div className="flex flex-col gap-4 p-6">
          <h2 id="confirm-title" className="text-lg font-semibold">
            {title}
          </h2>
          <div className="text-muted">{body}</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant={tone} onClick={onConfirm} loading={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
