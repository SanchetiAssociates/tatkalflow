import type { StationDto } from "@tatkalflow/shared";
import { MapPin, Star, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "../../components/ui";
import { useMyStations, useStationSearch, useToggleFavourite } from "../../lib/queries";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface Option extends StationDto {
  group?: "Favourites" | "Recent";
}

/**
 * Accessible station combobox (WAI-ARIA 1.2 combobox + listbox).
 * Empty input shows favourites and recent stations; typing searches by name
 * or code with typo tolerance (server-side, shared algorithm).
 */
export function StationPicker({
  label,
  value,
  onChange,
  error,
  excludeCode,
}: {
  label: string;
  value: StationDto | null;
  onChange: (s: StationDto | null) => void;
  error?: string;
  excludeCode?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query.trim(), 150);
  const search = useStationSearch(debounced);
  const mine = useMyStations();
  const fav = useToggleFavourite();

  const options: Option[] = useMemo(() => {
    const base: Option[] = debounced
      ? (search.data?.results ?? [])
      : [
          ...(mine.data?.favourites ?? []).map((s) => ({ ...s, group: "Favourites" as const })),
          ...(mine.data?.recents ?? []).filter((r) => !mine.data?.favourites.some((f) => f.code === r.code)).map((s) => ({ ...s, group: "Recent" as const })),
        ];
    return base.filter((s) => s.code !== excludeCode);
  }, [debounced, search.data, mine.data, excludeCode]);

  useEffect(() => setActive(0), [debounced]);

  const notInstalled = Boolean(debounced) && search.data?.datasetVersion === null;
  const isFavourite = value ? Boolean(mine.data?.favourites.some((f) => f.code === value.code)) : false;

  function choose(s: StationDto) {
    onChange({ code: s.code, name: s.name, state: s.state });
    setQuery("");
    setOpen(false);
  }

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span id={`${id}-label`} className="text-sm font-semibold">
          {label}
        </span>
        <div className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-surface px-4" aria-labelledby={`${id}-label`}>
          <MapPin aria-hidden className="size-5 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{value.name}</p>
            <p className="text-sm text-muted">{value.code}</p>
          </div>
          <button
            type="button"
            aria-label={isFavourite ? `Remove ${value.name} from favourites` : `Save ${value.name} as favourite`}
            aria-pressed={isFavourite}
            onClick={() => fav.mutate({ code: value.code, favourite: !isFavourite })}
            className="grid size-11 place-items-center rounded-xl text-muted hover:bg-surface-2"
          >
            <Star aria-hidden className={cx("size-5", isFavourite && "fill-accent text-accent")} />
          </button>
          <button
            type="button"
            aria-label={`Change ${label.toLowerCase()} station`}
            onClick={() => {
              onChange(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="grid size-11 place-items-center rounded-xl text-muted hover:bg-surface-2"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  const activeOption = open ? options[active] : undefined;
  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${id}-opt-${activeOption.code}` : undefined}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        autoComplete="off"
        spellCheck={false}
        placeholder="Station name or code"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            choose(options[active]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={cx("min-h-14 w-full rounded-2xl border bg-surface px-4 text-base", error ? "border-danger" : "border-border")}
      />
      <p id={`${id}-hint`} className="sr-only">
        Type to search. Use the up and down arrows to choose, Enter to select.
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div aria-live="polite" className="sr-only">
        {open && debounced && !search.isFetching ? `${options.length} stations found` : ""}
      </div>
      {open && (options.length > 0 || notInstalled || (debounced && !search.isFetching)) && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute top-full z-20 mt-1 max-h-80 w-full overflow-auto rounded-2xl border border-border bg-surface p-1 shadow-card"
        >
          {notInstalled && <li className="p-3 text-sm text-muted">The station list isn't installed on this server yet.</li>}
          {!notInstalled && debounced && options.length === 0 && <li className="p-3 text-sm text-muted">No stations match “{debounced}”.</li>}
          {options.map((s, i) => (
            <li
              key={`${s.group ?? "r"}-${s.code}`}
              id={`${id}-opt-${s.code}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
              onMouseEnter={() => setActive(i)}
              className={cx("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3", i === active && "bg-surface-2")}
            >
              <span className="w-14 shrink-0 font-mono text-sm font-semibold text-primary">{s.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{s.name}</span>
                {s.state && <span className="block truncate text-xs text-muted">{s.state}</span>}
              </span>
              {s.group && <span className="text-xs text-muted">{s.group}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
