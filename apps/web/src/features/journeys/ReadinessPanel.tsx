import { READINESS_LABELS, type ReadinessOverall, type ReadinessReport, type ReadinessStatus } from "@tatkalflow/shared";
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import { cx } from "../../components/ui";

const OVERALL: Record<ReadinessOverall, { icon: LucideIcon; tone: string; text: string }> = {
  READY: { icon: CheckCircle2, tone: "bg-success-soft text-success", text: "Everything needed for the booking step is configured." },
  WARNING: { icon: AlertTriangle, tone: "bg-warning-soft text-warning", text: "Usable, but some items aren't certain yet. Check them before Tatkal opens." },
  NOT_READY: { icon: XCircle, tone: "bg-danger-soft text-danger", text: "Fix the items marked “Missing” below." },
};

const ITEM: Record<ReadinessStatus, { icon: LucideIcon; tone: string; word: string }> = {
  PASS: { icon: CheckCircle2, tone: "text-success", word: "Done" },
  WARN: { icon: AlertTriangle, tone: "text-warning", word: "Check" },
  FAIL: { icon: XCircle, tone: "text-danger", word: "Missing" },
  INFO: { icon: Info, tone: "text-muted", word: "Note" },
};

/** Compact status pill for lists. Text and icon, never colour alone. */
export function ReadinessBadge({ status }: { status: ReadinessOverall }) {
  const { icon: Icon, tone } = OVERALL[status];
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold", tone)}>
      <Icon aria-hidden className="size-3.5" />
      {READINESS_LABELS[status]}
    </span>
  );
}

/** Booking-readiness preview. A preparation check only; it never books anything. */
export function ReadinessPanel({ report }: { report: ReadinessReport }) {
  const overall = OVERALL[report.overall];
  const OverallIcon = overall.icon;
  return (
    <section aria-labelledby="readiness-title" className="flex flex-col gap-3">
      <h2 id="readiness-title" className="text-lg font-semibold">
        Booking readiness
      </h2>
      <div role="status" className={cx("flex items-start gap-3 rounded-3xl p-5", overall.tone)}>
        <OverallIcon aria-hidden className="size-7 shrink-0" />
        <div>
          <p className="text-lg font-bold" data-testid="readiness-overall">
            {READINESS_LABELS[report.overall]}
          </p>
          <p className="text-sm">{overall.text}</p>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-3xl border border-border bg-surface">
        {report.items.map((i) => {
          const s = ITEM[i.status];
          const Icon = s.icon;
          return (
            <li key={i.key} className="flex items-start gap-3 p-4" data-status={i.status}>
              <Icon aria-hidden className={cx("mt-0.5 size-5 shrink-0", s.tone)} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {i.label} <span className={cx("ml-1 text-xs font-semibold uppercase tracking-wide", s.tone)}>{s.word}</span>
                </p>
                {i.detail && <p className="text-sm text-muted">{i.detail}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">
        This checks your preparation only. TatkalFlow doesn't book tickets: you sign in to IRCTC and complete CAPTCHA, OTP and payment yourself.
      </p>
    </section>
  );
}
