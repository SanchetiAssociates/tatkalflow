import { trainNumberSchema, type TrainDto } from "@tatkalflow/shared";
import { Plus, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Banner, Button, Input } from "../../../components/ui";
import { useTrainSearch } from "../../../lib/queries";
import type { DraftTrain } from "./draft";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const runsOnRoute = (t: TrainDto, from?: string, to?: string) => {
  if (!from || !to) return null;
  const i = t.stops.indexOf(from);
  const j = t.stops.indexOf(to);
  return i !== -1 && j !== -1 && i < j;
};

/**
 * Find a train and add it to the preferences. Trains come from the configured
 * train data provider (sample data in development); when none is configured,
 * a train number can be entered directly.
 */
export function TrainPicker({
  from,
  to,
  selected,
  max,
  providerAvailable,
  onAdd,
}: {
  from?: string;
  to?: string;
  selected: DraftTrain[];
  max: number;
  providerAvailable: boolean;
  onAdd: (t: DraftTrain) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const debounced = useDebounced(query.trim(), 150);
  const search = useTrainSearch(providerAvailable ? debounced : "", from, to);
  const full = selected.length >= max;
  const has = (n: string) => selected.some((t) => t.trainNumber === n);

  if (!providerAvailable) {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="text-sm font-semibold">
          Add a train by number
        </label>
        <div className="flex gap-2">
          <Input id={id} inputMode="numeric" maxLength={5} placeholder="5-digit train number" value={query} onChange={(e) => setQuery(e.target.value)} invalid={Boolean(manualError)} />
          <Button
            type="button"
            variant="secondary"
            disabled={full}
            onClick={() => {
              const parsed = trainNumberSchema.safeParse(query);
              if (!parsed.success) return setManualError(parsed.error.issues[0]?.message ?? "Check the train number");
              if (has(parsed.data)) return setManualError("This train is already on the list");
              setManualError(null);
              setQuery("");
              onAdd({ trainNumber: parsed.data, trainName: null });
            }}
          >
            <Plus aria-hidden className="size-5" /> Add
          </Button>
        </div>
        {manualError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {manualError}
          </p>
        )}
        <p className="text-sm text-muted">Train search isn't available yet, so names won't be shown.</p>
      </div>
    );
  }

  const results = debounced ? (search.data?.results ?? []) : [];
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        Find a train
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-3.5 left-4 size-5 text-muted" />
        <Input id={id} className="pl-11" placeholder="Train name or number" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} disabled={full} />
      </div>
      {full && <p className="text-sm text-muted">You've added the maximum of {max} trains. Remove one to add another.</p>}
      {debounced && !search.isFetching && results.length === 0 && <p className="text-sm text-muted">No trains match “{debounced}”.</p>}
      {results.length > 0 && (
        <ul aria-label="Train search results" className="flex flex-col gap-2">
          {results.map((t) => {
            const onRoute = runsOnRoute(t, from, to);
            const added = has(t.number);
            return (
              <li key={t.number}>
                <button
                  type="button"
                  disabled={added || full}
                  onClick={() => onAdd({ trainNumber: t.number, trainName: t.name })}
                  aria-label={`Add ${t.number} ${t.name}`}
                  className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-left hover:bg-surface-2 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {t.number} · {t.name}
                    </span>
                    <span className="block text-sm text-muted">
                      {t.fromStationCode} → {t.toStationCode}
                      {onRoute === true && " · runs on your route"}
                      {onRoute === false && " · not known to run on your route"}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-primary">{added ? "Added" : "Add"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {search.data?.provider === "mock" && (
        <Banner tone="info">Train search uses sample data in this development build. These are not real trains.</Banner>
      )}
    </div>
  );
}
