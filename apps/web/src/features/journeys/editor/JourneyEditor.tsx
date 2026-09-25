import { todayInIndia, type JourneyConfigDto, type JourneyOptionsDto, type PassengerDto } from "@tatkalflow/shared";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Banner, Button, cx, ErrorState, Spinner } from "../../../components/ui";
import { ApiError } from "../../../lib/api";
import { useJourneyOptions, usePassengers } from "../../../lib/queries";
import { JourneySummary } from "../JourneySummary";
import { draftErrorKey, STEPS, stepForField, validateStep, type Draft, type DraftErrors, type EditorMode, type StepId } from "./draft";
import { ClassesStep, PassengersStep, PreferencesStep, RouteStep, TrainsStep } from "./steps";

/** What the Review step shows, built from the draft before anything is saved. */
function previewConfig(d: Draft, passengers: PassengerDto[]): JourneyConfigDto {
  const byId = new Map(passengers.map((p) => [p.id, p]));
  return {
    id: "preview",
    name: d.name.trim() || `${d.from?.name ?? ""} to ${d.to?.name ?? ""}`,
    fromStationCode: d.from?.code ?? "",
    fromStationName: d.from?.name ?? null,
    toStationCode: d.to?.code ?? "",
    toStationName: d.to?.name ?? null,
    boardingStationCode: d.boarding?.code ?? null,
    boardingStationName: d.boarding?.name ?? null,
    quota: d.quota,
    passengers: d.passengers.flatMap((sel) => {
      const p = byId.get(sel.passengerId);
      return p ? [{ id: p.id, name: p.name, age: p.age, gender: p.gender, berthPreference: sel.berthPreference, seniorCitizenOptIn: p.seniorCitizenOptIn, removed: false }] : [];
    }),
    trains: d.trains.map((t, i) => ({ priority: i + 1, ...t })),
    classes: d.classes.map((classCode, i) => ({ priority: i + 1, classCode })),
    anyTrainAllowed: d.anyTrainAllowed,
    useNextAvailableClass: d.useNextAvailableClass,
    considerAutoUpgradation: d.considerAutoUpgradation,
    racWaitlistPreference: d.racWaitlistPreference,
    createdAt: "",
    updatedAt: "",
  };
}

export function passengerLimitFor(options: JourneyOptionsDto | undefined, quota: Draft["quota"]): number | null {
  const v = options?.rules.passengerLimit[quota]?.value;
  return typeof v === "number" ? v : null;
}

/**
 * Progressive, mobile-first journey / template editor: one short step at a
 * time, with validation before moving on. Optional preferences never block.
 */
export function JourneyEditor({
  mode,
  initial,
  submitLabel,
  onSubmit,
}: {
  mode: EditorMode;
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<void>;
}) {
  const options = useJourneyOptions();
  const passengers = usePassengers();
  const [draft, setDraft] = useState<Draft>(initial);
  const [stepIndex, setStepIndex] = useState(0);
  const [visited, setVisited] = useState(0);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const step = STEPS[stepIndex]!;

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus(); // move screen-reader and keyboard focus to the new step
  }, [stepIndex]);

  if (options.isPending) return <Spinner label="Loading journey options" />;
  if (options.isError) return <ErrorState message="Couldn't load journey options." onRetry={() => void options.refetch()} />;

  const ctx = { mode, today: todayInIndia(), passengerLimit: passengerLimitFor(options.data, draft.quota) };
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k as keyof DraftErrors];
      return next;
    });
  };

  function goTo(i: number) {
    setServerError(null);
    setStepIndex(i);
    setVisited((v) => Math.max(v, i));
  }

  function next() {
    const e = validateStep(step.id, draft, ctx);
    setErrors(e);
    if (Object.keys(e).length) return;
    goTo(stepIndex + 1);
  }

  async function save() {
    // Re-check every step; jump to the first one with a problem.
    for (const [i, s] of STEPS.entries()) {
      const e = validateStep(s.id, draft, ctx);
      if (Object.keys(e).length) {
        setErrors(e);
        return goTo(i);
      }
    }
    setSaving(true);
    setServerError(null);
    try {
      await onSubmit(draft);
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) {
        const e: DraftErrors = {};
        for (const f of err.fields) {
          const k = draftErrorKey(f.path);
          if (k) e[k] ??= f.message;
        }
        setErrors(e);
        const first = STEPS.findIndex((s) => s.id === stepForField(err.fields[0]!.path));
        goTo(first === -1 ? 0 : first);
        setServerError(err.fields.map((f) => f.message).join(" "));
      } else {
        setServerError(err instanceof ApiError ? err.message : "Couldn't save. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  const stepProps = { draft, update, errors, options: options.data, mode };
  const bodies: Record<StepId, React.ReactNode> = {
    route: <RouteStep {...stepProps} />,
    trains: <TrainsStep {...stepProps} />,
    classes: <ClassesStep {...stepProps} />,
    passengers: <PassengersStep {...stepProps} passengers={passengers.data ?? []} loading={passengers.isPending} />,
    preferences: <PreferencesStep {...stepProps} />,
    review: <JourneySummary config={previewConfig(draft, passengers.data ?? [])} {...(mode === "journey" && { journeyDate: draft.journeyDate })} />,
  };
  const last = stepIndex === STEPS.length - 1;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Steps">
        <p className="mb-2 text-sm text-muted">
          Step {stepIndex + 1} of {STEPS.length}
        </p>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
        </div>
        <ol className="flex gap-1.5 overflow-x-auto pb-1">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => goTo(i)}
                disabled={i > visited}
                aria-current={i === stepIndex ? "step" : undefined}
                className={cx(
                  "inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-sm font-medium",
                  i === stepIndex ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-text disabled:opacity-40",
                )}
              >
                {i < visited && i !== stepIndex && <Check aria-hidden className="size-4" />}
                {s.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
        {step.title}
      </h2>
      <div className="animate-rise flex flex-col gap-5">{bodies[step.id]}</div>

      {serverError && <Banner tone="danger">{serverError}</Banner>}

      <div className="sticky bottom-20 z-10 flex gap-3 rounded-3xl bg-bg/90 py-2 backdrop-blur md:bottom-4">
        {stepIndex > 0 && (
          <Button type="button" variant="secondary" onClick={() => goTo(stepIndex - 1)} className="flex-1">
            <ArrowLeft aria-hidden className="size-5" /> Back
          </Button>
        )}
        {last ? (
          <Button type="button" onClick={() => void save()} loading={saving} className="flex-[2]">
            {submitLabel}
          </Button>
        ) : (
          <Button type="button" onClick={next} className="flex-[2]">
            Next <ArrowRight aria-hidden className="size-5" />
          </Button>
        )}
      </div>
    </div>
  );
}
