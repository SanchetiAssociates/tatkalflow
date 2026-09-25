import {
  CLASS_NAMES,
  QUOTA_LABELS,
  RAC_WAITLIST_LABELS,
  RULE_LABELS,
  type ClassCode,
  type JourneyConfigDto,
  type RuleKey,
  type RuleSnapshot,
} from "@tatkalflow/shared";
import type { ReactNode } from "react";
import { berthSummary, formatJourneyDate, passengerSummary } from "../../lib/format";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-surface p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-4">
      <dt className="text-sm text-muted sm:w-40 sm:shrink-0">{term}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

const onOff = (v: boolean) => (v ? "Yes" : "No");

/** Mobile-first summary of a journey or template configuration. */
export function JourneySummary({ config, journeyDate, ruleSnapshot }: { config: JourneyConfigDto; journeyDate?: string; ruleSnapshot?: RuleSnapshot | null }) {
  return (
    <div className="flex flex-col gap-3">
      <Section title="Route">
        <dl>
          <Row term="From">
            {config.fromStationName ?? config.fromStationCode} <span className="text-muted">({config.fromStationCode})</span>
          </Row>
          <Row term="To">
            {config.toStationName ?? config.toStationCode} <span className="text-muted">({config.toStationCode})</span>
          </Row>
          <Row term="Boarding point">
            {config.boardingStationCode ? `${config.boardingStationName ?? config.boardingStationCode} (${config.boardingStationCode})` : "Same as From"}
          </Row>
          {journeyDate && <Row term="Journey date">{formatJourneyDate(journeyDate)}</Row>}
          <Row term="Quota">{QUOTA_LABELS[config.quota]}</Row>
        </dl>
      </Section>

      <Section title="Preferred trains">
        {config.trains.length === 0 ? (
          <p className="text-muted">{config.anyTrainAllowed ? "Any train on this route." : "No trains chosen yet."}</p>
        ) : (
          <ol className="flex flex-col gap-1.5" aria-label="Preferred trains in priority order">
            {config.trains.map((t) => (
              <li key={t.trainNumber} className="flex gap-3">
                <span className="w-6 shrink-0 font-bold text-primary">{t.priority}.</span>
                <span>
                  {t.trainNumber}
                  {t.trainName && <span className="text-muted"> · {t.trainName}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        {config.trains.length > 0 && config.anyTrainAllowed && <p className="mt-2 text-sm text-muted">Other trains on this route are also fine.</p>}
      </Section>

      <Section title="Class preference">
        <ol className="flex flex-col gap-1.5" aria-label="Classes in priority order">
          {config.classes.map((k) => (
            <li key={k.classCode} className="flex gap-3">
              <span className="w-6 shrink-0 font-bold text-primary">{k.priority}.</span>
              <span>
                {k.classCode} <span className="text-muted">· {CLASS_NAMES[k.classCode as ClassCode] ?? k.classCode}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-sm text-muted">{config.useNextAvailableClass ? "If none are available, try the next class on the list." : "Only these classes."}</p>
      </Section>

      <Section title={`Passengers (${config.passengers.length})`}>
        {config.passengers.length === 0 ? (
          <p className="text-muted">No passengers yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {config.passengers.map((p) => (
              <li key={p.id}>
                <p className="font-semibold">
                  {p.name}
                  {p.removed && <span className="ml-2 text-xs font-semibold text-warning">Removed from saved passengers</span>}
                </p>
                <p className="text-sm text-muted">
                  {passengerSummary(p)} · {berthSummary(p)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Booking preferences">
        <dl>
          <Row term="RAC / waitlist">{RAC_WAITLIST_LABELS[config.racWaitlistPreference]}</Row>
          <Row term="Auto-upgradation">{onOff(config.considerAutoUpgradation)}</Row>
        </dl>
      </Section>

      {ruleSnapshot && (
        <details className="rounded-3xl border border-border bg-surface p-5">
          <summary className="cursor-pointer text-sm font-semibold">Railway rules when this journey was created</summary>
          <p className="mt-2 text-sm text-muted">Recorded {new Date(ruleSnapshot.capturedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {Object.entries(ruleSnapshot.rules).map(([key, r]) => (
              <li key={key}>
                {RULE_LABELS[key as RuleKey] ?? key}:{" "}
                {r ? (
                  <>
                    {JSON.stringify(r.value)} <span className="text-muted">({r.isVerified ? "verified" : "not verified"})</span>
                  </>
                ) : (
                  <span className="text-muted">not configured</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
