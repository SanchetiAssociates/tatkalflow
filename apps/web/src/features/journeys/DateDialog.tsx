import { todayInIndia } from "@tatkalflow/shared";
import { useState, type ReactNode } from "react";
import { ConfirmDialog, Field, Input } from "../../components/ui";

/** Ask for a journey date (duplicate, or plan from a template). */
export function DateDialog({
  open,
  title,
  body,
  confirmLabel,
  initialDate = "",
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  initialDate?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (date: string) => void;
  onCancel: () => void;
}) {
  const today = todayInIndia();
  const [date, setDate] = useState(initialDate >= today ? initialDate : "");
  const [localError, setLocalError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open={open}
      title={title}
      tone="primary"
      confirmLabel={confirmLabel}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (!date) return setLocalError("Choose a travel date");
        if (date < today) return setLocalError("That date has passed");
        setLocalError(null);
        onConfirm(date);
      }}
      body={
        <div className="flex flex-col gap-3">
          {body}
          <Field label="Journey date" htmlFor="dialog-journey-date" error={localError ?? error ?? undefined}>
            <Input id="dialog-journey-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} invalid={Boolean(localError ?? error)} />
          </Field>
        </div>
      }
    />
  );
}
