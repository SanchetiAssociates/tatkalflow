import {
  BERTH_LABELS,
  BERTH_PREFERENCES,
  CLASS_NAMES,
  isTatkalQuota,
  nameLength,
  todayInIndia,
  type BerthPreference,
  type ClassCode,
  type JourneyOptionsDto,
  type PassengerDto,
  type RuleInfoDto,
} from "@tatkalflow/shared";
import { ArrowDownUp, Check, Plus } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { Banner, cx, Field, Input, ListSkeleton, Segmented, Switch } from "../../../components/ui";
import { passengerSummary } from "../../../lib/format";
import { StationPicker } from "../../stations/StationPicker";
import type { Draft, DraftErrors, EditorMode } from "./draft";
import { OrderedList } from "./OrderedList";
import { TrainPicker } from "./TrainPicker";

interface StepProps {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  errors: DraftErrors;
  options: JourneyOptionsDto;
  mode: EditorMode;
}

/** "(not yet verified)" suffix for rule-driven text, so nothing claims more certainty than the rule has. */
const unverified = (r: RuleInfoDto) => (r.isVerified ? "" : " This rule hasn't been verified against an official source yet.");

// ── 1. Route ─────────────────────────────────────────────────────────────

export function RouteStep({ draft, update, errors, mode }: StepProps) {
  const today = todayInIndia();
  const [separateBoarding, setSeparateBoarding] = useState(draft.boarding !== null);
  return (
    <>
      <Field
        label={mode === "template" ? "Template name" : "Journey name (optional)"}
        htmlFor="journey-name"
        error={errors.name}
        hint={mode === "template" ? "For example “Diwali home trip”." : "Leave blank to use the route as the name."}
      >
        <Input id="journey-name" maxLength={60} autoComplete="off" value={draft.name} onChange={(e) => update({ name: e.target.value })} invalid={Boolean(errors.name)} />
      </Field>
      <StationPicker label="From" value={draft.from} onChange={(from) => update({ from })} error={errors.from} excludeCode={draft.to?.code} />
      <div className="-my-2 flex justify-center">
        <button
          type="button"
          onClick={() => update({ from: draft.to, to: draft.from })}
          className="grid size-11 place-items-center rounded-full border border-border bg-surface text-muted"
          aria-label="Swap From and To"
        >
          <ArrowDownUp aria-hidden className="size-5" />
        </button>
      </div>
      <StationPicker label="To" value={draft.to} onChange={(to) => update({ to })} error={errors.to} excludeCode={draft.from?.code} />
      <Switch
        label="Boarding at a different station"
        description="Only if you'll board after the From station."
        checked={separateBoarding}
        onChange={(on) => {
          setSeparateBoarding(on);
          if (!on) update({ boarding: null });
        }}
      />
      {separateBoarding && (
        <StationPicker label="Boarding point" value={draft.boarding} onChange={(boarding) => update({ boarding })} error={errors.boarding} excludeCode={draft.to?.code} />
      )}
      {mode === "journey" && (
        <Field label="Journey date" htmlFor="journey-date" error={errors.journeyDate} hint="The date the train leaves your boarding station.">
          <Input
            id="journey-date"
            type="date"
            min={today}
            value={draft.journeyDate}
            onChange={(e) => update({ journeyDate: e.target.value })}
            invalid={Boolean(errors.journeyDate)}
            className="max-w-56"
          />
        </Field>
      )}
    </>
  );
}

// ── 2. Trains ────────────────────────────────────────────────────────────

export function TrainsStep({ draft, update, options }: StepProps) {
  return (
    <>
      <p className="text-muted">Add the trains you'd like, most preferred first. You can change the order at any time.</p>
      <OrderedList
        label="Preferred trains"
        items={draft.trains}
        itemLabel={(t) => t.trainNumber}
        onChange={(trains) => update({ trains })}
        render={(t) => (
          <>
            <p className="font-semibold">{t.trainNumber}</p>
            {t.trainName && <p className="truncate text-sm text-muted">{t.trainName}</p>}
          </>
        )}
        empty={<p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">No trains added yet.</p>}
      />
      <TrainPicker
        from={draft.boarding?.code ?? draft.from?.code}
        to={draft.to?.code}
        selected={draft.trains}
        max={options.maxPreferredTrains}
        providerAvailable={options.trainData.available}
        onAdd={(t) => update({ trains: [...draft.trains, t] })}
      />
      <Switch
        label="Any train on this route is fine"
        description="Use this if you don't mind which train, or as a fallback after your preferred trains."
        checked={draft.anyTrainAllowed}
        onChange={(anyTrainAllowed) => update({ anyTrainAllowed })}
      />
    </>
  );
}

// ── 3. Class & quota ─────────────────────────────────────────────────────

export function ClassesStep({ draft, update, errors, options }: StepProps) {
  const categories = new Map(options.classes.map((k) => [k.code, k.tatkalCategory]));
  const tatkal = isTatkalQuota(draft.quota);
  const available = options.classes.filter((k) => !draft.classes.includes(k.code));
  return (
    <>
      <Segmented label="Quota" name="quota" value={draft.quota} onChange={(quota) => update({ quota })} options={options.quotas} />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Class preference, in order</p>
        <OrderedList
          label="Class preference"
          items={draft.classes}
          minItems={1}
          itemLabel={(k) => k}
          onChange={(classes) => update({ classes })}
          render={(k) => (
            <>
              <p className="font-semibold">
                {k} <span className="font-normal text-muted">· {CLASS_NAMES[k]}</span>
              </p>
              {tatkal && categories.get(k) === "UNKNOWN" && <p className="text-sm text-warning">Tatkal rules for this class aren't configured yet.</p>}
            </>
          )}
        />
        {errors.classes && (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors.classes}
          </p>
        )}
      </div>
      {available.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Add a class</p>
          <div className="flex flex-wrap gap-2">
            {available.map((k) => (
              <button
                key={k.code}
                type="button"
                onClick={() => update({ classes: [...draft.classes, k.code] })}
                aria-label={`Add ${k.code} ${k.name}`}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2"
              >
                <Plus aria-hidden className="size-4" /> {k.code}
              </button>
            ))}
          </div>
        </div>
      )}
      <Switch
        label="Try the next class if these aren't available"
        checked={draft.useNextAvailableClass}
        onChange={(useNextAvailableClass) => update({ useNextAvailableClass })}
      />
    </>
  );
}

// ── 4. Passengers ────────────────────────────────────────────────────────

export function PassengersStep({ draft, update, errors, options, passengers, loading }: StepProps & { passengers: PassengerDto[]; loading: boolean }) {
  const limitRule = options.rules.passengerLimit[draft.quota];
  const nameRule = options.rules.nameMaxLength;
  const maxName = typeof nameRule.value === "number" ? nameRule.value : null;
  const concession = options.rules.seniorConcessionOnTatkal;
  const selected = new Map(draft.passengers.map((p) => [p.passengerId, p]));
  const seniorsSelected = passengers.some((p) => selected.has(p.id) && p.seniorCitizenOptIn);

  function toggle(p: PassengerDto) {
    update({
      passengers: selected.has(p.id) ? draft.passengers.filter((s) => s.passengerId !== p.id) : [...draft.passengers, { passengerId: p.id, berthPreference: p.berthPreference }],
    });
  }
  function setBerth(id: string, berthPreference: BerthPreference) {
    update({ passengers: draft.passengers.map((s) => (s.passengerId === id ? { ...s, berthPreference } : s)) });
  }

  return (
    <>
      {typeof limitRule.value === "number" ? (
        <Banner tone={limitRule.isVerified ? "info" : "warning"}>
          Up to {limitRule.value} passengers per booking.{unverified(limitRule)}
        </Banner>
      ) : (
        <Banner tone="warning">The passenger limit per booking isn't configured yet, so it can't be checked here.</Banner>
      )}
      {isTatkalQuota(draft.quota) && seniorsSelected && concession.concession === "UNAVAILABLE" && (
        <Banner tone="info" title="No senior-citizen concession on Tatkal">
          Senior-citizen concession isn't available on Tatkal bookings. Passengers who opted in will be booked at the normal Tatkal fare.{unverified(concession)}
        </Banner>
      )}
      <fieldset className="flex flex-col gap-2" aria-describedby={errors.passengers ? "journey-passengers-error" : undefined}>
        <legend className="mb-1.5 text-sm font-semibold">
          Passengers ({draft.passengers.length} selected)
        </legend>
        {loading && <ListSkeleton rows={2} label="Loading passengers" />}
        {!loading && passengers.length === 0 && <p className="text-sm text-muted">No saved passengers yet.</p>}
        <ul className="flex flex-col gap-2">
          {passengers.map((p) => (
            <PassengerRow
              key={p.id}
              passenger={p}
              selection={selected.get(p.id)}
              maxName={maxName}
              onToggle={() => toggle(p)}
              onBerth={(b) => setBerth(p.id, b)}
            />
          ))}
        </ul>
        {errors.passengers && (
          <p id="journey-passengers-error" role="alert" className="text-sm font-medium text-danger">
            {errors.passengers}
          </p>
        )}
      </fieldset>
      <Link to="/passengers/new" className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-primary">
        <Plus aria-hidden className="size-4" /> Add a passenger
      </Link>
    </>
  );
}

function PassengerRow({
  passenger: p,
  selection,
  maxName,
  onToggle,
  onBerth,
}: {
  passenger: PassengerDto;
  selection: { berthPreference: BerthPreference } | undefined;
  maxName: number | null;
  onToggle: () => void;
  onBerth: (b: BerthPreference) => void;
}) {
  const berthId = useId();
  const checked = Boolean(selection);
  const tooLong = maxName !== null && nameLength(p.name) > maxName;
  return (
    <li className={cx("rounded-2xl border p-3 transition", checked ? "border-primary bg-surface-2" : "border-border bg-surface")}>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--focus)]">
        <input type="checkbox" className="sr-only" checked={checked} onChange={onToggle} />
        <span aria-hidden className={cx("grid size-6 place-items-center rounded-md border", checked ? "border-primary bg-primary text-primary-fg" : "border-border")}>
          {checked && <Check className="size-4" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{p.name}</span>
          <span className="block text-sm text-muted">{passengerSummary(p)}</span>
        </span>
      </label>
      {tooLong && (
        <p className="mt-2 text-sm text-warning">
          Name is longer than {maxName} characters.{" "}
          <Link to={`/passengers/${p.id}/edit`} className="font-semibold underline">
            Edit passenger
          </Link>
        </p>
      )}
      {selection && (
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor={berthId} className="text-sm text-muted">
            Berth for this journey
          </label>
          <select
            id={berthId}
            value={selection.berthPreference}
            onChange={(e) => onBerth(e.target.value as BerthPreference)}
            className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm"
          >
            {BERTH_PREFERENCES.map((b) => (
              <option key={b} value={b}>
                {BERTH_LABELS[b]}
              </option>
            ))}
          </select>
        </div>
      )}
    </li>
  );
}

// ── 5. Preferences ───────────────────────────────────────────────────────

export function PreferencesStep({ draft, update, options }: StepProps) {
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold">If confirmed berths run out</legend>
        {options.racWaitlistPreferences.map((o) => {
          const checked = draft.racWaitlistPreference === o.value;
          return (
            <label
              key={o.value}
              className={cx(
                "flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--focus)]",
                checked ? "border-primary bg-surface-2" : "border-border bg-surface",
              )}
            >
              <input type="radio" name="rac-waitlist" className="mt-1 size-5 accent-[var(--primary)]" checked={checked} onChange={() => update({ racWaitlistPreference: o.value })} />
              <span>
                <span className="block font-semibold">{o.label}</span>
                <span className="block text-sm text-muted">{o.description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <Switch
        label="Consider for auto-upgradation"
        description="Lets IRCTC consider this booking for a higher class where it offers auto-upgradation."
        checked={draft.considerAutoUpgradation}
        onChange={(considerAutoUpgradation) => update({ considerAutoUpgradation })}
      />
      <p className="text-sm text-muted">These are saved as your preferences. Nothing is booked from TatkalFlow.</p>
    </>
  );
}
