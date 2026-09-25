import type { PassengerDto } from "@tatkalflow/shared";
import { Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { berthSummary, passengerSummary } from "../../lib/format";

/** User-entered text is rendered as React text nodes only (escaped), never as HTML. */
export function PassengerCard({ passenger, onDelete }: { passenger: PassengerDto; onDelete: (p: PassengerDto) => void }) {
  const initials = passenger.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <li className="flex items-center gap-4 rounded-3xl border border-border bg-surface p-4 shadow-card">
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-2 font-semibold text-primary">
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold" data-testid="passenger-name">
          {passenger.name}
        </p>
        <p className="text-sm text-muted">
          {passengerSummary(passenger)}
          <br />
          {berthSummary(passenger)}
        </p>
      </div>
      <Link to={`/passengers/${passenger.id}/edit`} className="grid size-11 place-items-center rounded-xl text-muted hover:bg-surface-2" aria-label={`Edit ${passenger.name}`}>
        <Pencil aria-hidden className="size-5" />
      </Link>
      <button type="button" onClick={() => onDelete(passenger)} className="grid size-11 place-items-center rounded-xl text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Delete ${passenger.name}`}>
        <Trash2 aria-hidden className="size-5" />
      </button>
    </li>
  );
}
