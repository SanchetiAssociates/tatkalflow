import { ArrowRight, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { formatJourneyDate } from "../../lib/format";
import type { JourneyDto } from "../../lib/queries";
import { ReadinessBadge } from "./ReadinessPanel";

export function JourneyCard({ journey, onDelete }: { journey: JourneyDto; onDelete?: (j: JourneyDto) => void }) {
  return (
    <li className="rounded-3xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/trips/${journey.id}`} className="min-w-0 flex-1 rounded-xl">
          <p className="truncate text-sm font-semibold text-primary">{journey.name}</p>
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span>{journey.fromStationName ?? journey.fromStationCode}</span>
            <ArrowRight aria-label="to" className="size-4 text-muted" />
            <span>{journey.toStationName ?? journey.toStationCode}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted">{formatJourneyDate(journey.journeyDate)}</p>
        </Link>
        {journey.readinessStatus && <ReadinessBadge status={journey.readinessStatus} />}
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
