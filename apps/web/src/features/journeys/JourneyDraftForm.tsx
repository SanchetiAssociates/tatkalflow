import { journeyDraftSchema, todayInIndia, type StationDto } from "@tatkalflow/shared";
import { ArrowDownUp, CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Banner, Button, Field, Input } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { formatJourneyDate } from "../../lib/format";
import { useCreateJourney, type JourneyDto } from "../../lib/queries";
import { PassengerPicker } from "../passengers/PassengerPicker";
import { StationPicker } from "../stations/StationPicker";

type Errors = Partial<Record<"fromStationCode" | "toStationCode" | "journeyDate" | "passengerIds", string>>;

export function JourneyDraftForm({ submitLabel = "Save journey", onDone, onSaved }: { submitLabel?: string; onDone: () => void; onSaved?: () => void }) {
  const create = useCreateJourney();
  const [from, setFrom] = useState<StationDto | null>(null);
  const [to, setTo] = useState<StationDto | null>(null);
  const [date, setDate] = useState("");
  const [passengerIds, setPassengerIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ journey: JourneyDto; warnings: string[] } | null>(null);
  const today = todayInIndia();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const parsed = journeyDraftSchema.safeParse({ fromStationCode: from?.code ?? "", toStationCode: to?.code ?? "", journeyDate: date, passengerIds });
    const next: Errors = {};
    if (!from) next.fromStationCode = "Choose where you're travelling from";
    if (!to) next.toStationCode = "Choose your destination";
    if (!date) next.journeyDate = "Choose a travel date";
    else if (date < today) next.journeyDate = "That date has passed";
    if (!parsed.success) for (const i of parsed.error.issues) next[i.path[0] as keyof Errors] ??= i.message;
    setErrors(next);
    if (Object.keys(next).length || !parsed.success) return;
    try {
      setSaved(await create.mutateAsync(parsed.data));
      onSaved?.();
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) {
        setErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])) as Errors);
      } else setServerError(err instanceof ApiError ? err.message : "Couldn't save the journey.");
    }
  }

  if (saved) {
    return (
      <div className="animate-rise flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-3xl bg-success-soft p-5 text-success">
          <CheckCircle2 aria-hidden className="size-6 shrink-0" />
          <div>
            <p className="font-semibold">Journey saved as a draft</p>
            <p className="text-sm">
              {saved.journey.fromStationName} → {saved.journey.toStationName} · {formatJourneyDate(saved.journey.journeyDate)}
            </p>
          </div>
        </div>
        {saved.warnings.map((w) => (
          <Banner key={w} tone="warning">
            {w}
          </Banner>
        ))}
        <Button block onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <StationPicker label="From" value={from} onChange={setFrom} error={errors.fromStationCode} excludeCode={to?.code} />
      <div className="-my-2 flex justify-center">
        <button
          type="button"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
          className="grid size-11 place-items-center rounded-full border border-border bg-surface text-muted"
          aria-label="Swap From and To"
        >
          <ArrowDownUp aria-hidden className="size-5" />
        </button>
      </div>
      <StationPicker label="To" value={to} onChange={setTo} error={errors.toStationCode} excludeCode={from?.code} />
      <Field label="Journey date" htmlFor="journey-date" error={errors.journeyDate} hint="The date the train departs your boarding station.">
        <Input id="journey-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} invalid={Boolean(errors.journeyDate)} className="max-w-56" />
      </Field>
      <PassengerPicker value={passengerIds} onChange={setPassengerIds} error={errors.passengerIds} />
      {serverError && <Banner tone="danger">{serverError}</Banner>}
      <Button type="submit" block loading={create.isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}
