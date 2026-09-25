import { ArrowRight, Trash2 } from "lucide-react";
import { formatJourneyDate } from "../../lib/format";
import type { JourneyDto } from "../../lib/queries";

const STATE_LABEL: Record<string, string> = { DRAFT: "Draft", SCHEDULED: "Scheduled", CANCELLED: "Cancelled" };

export function JourneyCard({ journey, onDelete }: { journey: JourneyDto; onDelete?: (j: JourneyDto) => void }) {
  return (
    <li className="rounded-3xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span>{journey.fromStationName ?? journey.fromStationCode}</span>
            <ArrowRight aria-label="to" className="size-4 text-muted" />
            <span>{journey.toStationName ?? journey.toStationCode}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted">{formatJourneyDate(journey.journeyDate)}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold">{STATE_LABEL[journey.state] ?? journey.state}</span>
      </div>
      <p className="mt-3 text-sm text-muted">
        {journey.passengers.length} passenger{journey.passengers.length === 1 ? "" : "s"}: {journey.passengers.map((p) => p.name).join(", ")}
      </p>
      {onDelete && (
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => onDelete(journey)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted hover:bg-danger-soft hover:text-danger">
            <Trash2 aria-hidden className="size-4" /> Delete
          </button>
        </div>
      )}
    </li>
  );
}
