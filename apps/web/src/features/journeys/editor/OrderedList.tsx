import { moveItem } from "@tatkalflow/shared";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * An ordered list where position is the priority (1 = first choice).
 * Reordering uses explicit Move up / Move down buttons (keyboard and screen
 * reader friendly, no drag-and-drop required), and every change is announced.
 */
export function OrderedList<T>({
  label,
  items,
  itemLabel,
  render,
  onChange,
  empty,
  minItems = 0,
}: {
  label: string;
  items: readonly T[];
  /** Short name used in button labels and announcements, e.g. "3A". */
  itemLabel: (item: T) => string;
  render: (item: T) => ReactNode;
  onChange: (next: T[]) => void;
  empty?: ReactNode;
  minItems?: number;
}) {
  const [announcement, setAnnouncement] = useState("");

  function move(from: number, to: number) {
    const item = items[from];
    if (item === undefined) return;
    onChange(moveItem(items, from, to));
    setAnnouncement(`${itemLabel(item)} moved to priority ${to + 1}`);
  }

  function remove(index: number) {
    const item = items[index];
    if (item === undefined) return;
    onChange(items.filter((_, i) => i !== index));
    setAnnouncement(`${itemLabel(item)} removed`);
  }

  return (
    <div>
      {items.length === 0 ? (
        empty
      ) : (
        <ol aria-label={label} className="flex flex-col gap-2">
          {items.map((item, i) => {
            const name = itemLabel(item);
            return (
              <li key={name} className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-surface p-2 pl-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-fg" aria-label={`Priority ${i + 1}`}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">{render(item)}</div>
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move ${name} up`}
                  className="grid size-11 place-items-center rounded-xl text-muted hover:bg-surface-2 disabled:opacity-30"
                >
                  <ArrowUp aria-hidden className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === items.length - 1}
                  aria-label={`Move ${name} down`}
                  className="grid size-11 place-items-center rounded-xl text-muted hover:bg-surface-2 disabled:opacity-30"
                >
                  <ArrowDown aria-hidden className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={items.length <= minItems}
                  aria-label={`Remove ${name}`}
                  className="grid size-11 place-items-center rounded-xl text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-30"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
