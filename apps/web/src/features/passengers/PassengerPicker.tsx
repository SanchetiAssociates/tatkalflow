import { Check, Plus } from "lucide-react";
import { Link } from "react-router";
import { cx, ListSkeleton } from "../../components/ui";
import { berthSummary, passengerSummary } from "../../lib/format";
import { usePassengers } from "../../lib/queries";

/** Multi-select passenger cards (checkbox semantics). */
export function PassengerPicker({ value, onChange, error }: { value: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const { data, isPending } = usePassengers();
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? "passengers-error" : undefined}>
      <legend className="mb-1.5 text-sm font-semibold">Passengers</legend>
      {isPending && <ListSkeleton rows={2} label="Loading passengers" />}
      {data?.length === 0 && <p className="text-sm text-muted">No saved passengers yet.</p>}
      <ul className="flex flex-col gap-2">
        {data?.map((p) => {
          const checked = value.includes(p.id);
          return (
            <li key={p.id}>
              <label
                className={cx(
                  "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border p-3 transition has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--focus)]",
                  checked ? "border-primary bg-surface-2" : "border-border bg-surface",
                )}
              >
                <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(p.id)} />
                <span aria-hidden className={cx("grid size-6 place-items-center rounded-md border", checked ? "border-primary bg-primary text-primary-fg" : "border-border")}>
                  {checked && <Check className="size-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block text-sm text-muted">
                    {passengerSummary(p)} · {berthSummary(p)}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <Link to="/passengers/new" className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-primary">
        <Plus aria-hidden className="size-4" /> Add a passenger
      </Link>
      {error && (
        <p id="passengers-error" role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
