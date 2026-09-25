import { ArrowRight, Bookmark, Plus, TrainFront } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Banner, ButtonLink, ConfirmDialog, EmptyState, ErrorState, ListSkeleton, PageHeader } from "../../components/ui";
import { formatJourneyDate } from "../../lib/format";
import { useDeleteJourney, useJourneys, useJourneyTemplates, type JourneyDto } from "../../lib/queries";
import { JourneyCard } from "./JourneyCard";

export default function Trips() {
  const { data, isPending, isError, refetch } = useJourneys();
  const templates = useJourneyTemplates();
  const del = useDeleteJourney();
  const [pending, setPending] = useState<JourneyDto | null>(null);
  return (
    <>
      <PageHeader
        title="Trips"
        subtitle="Your planned journeys, soonest first."
        action={
          data && data.length > 0 ? (
            <ButtonLink to="/trips/new" variant="secondary" className="min-h-11 px-4">
              <Plus aria-hidden className="size-5" /> New
            </ButtonLink>
          ) : undefined
        }
      />
      {isPending && <ListSkeleton label="Loading trips" />}
      {isError && <ErrorState message="Couldn't load your trips." onRetry={() => void refetch()} />}
      {data?.length === 0 && (
        <EmptyState icon={TrainFront} title="No journeys planned" action={<ButtonLink to="/trips/new" block>Plan a journey</ButtonLink>}>
          Plan a journey weeks ahead: route, trains, classes and passengers, ready for Tatkal day.
        </EmptyState>
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.map((j) => (
            <JourneyCard key={j.id} journey={j} onDelete={setPending} />
          ))}
        </ul>
      )}

      <section aria-labelledby="templates-title" className="mt-8 flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="templates-title" className="text-lg font-semibold">
              Templates
            </h2>
            <p className="text-sm text-muted">Reusable setups for journeys you make often.</p>
          </div>
          <ButtonLink to="/trips/templates/new" variant="secondary" className="min-h-11 px-4">
            <Plus aria-hidden className="size-5" /> Template
          </ButtonLink>
        </div>
        {templates.isPending && <ListSkeleton rows={1} label="Loading templates" />}
        {/* Not role="alert": a journeys error above already announces the problem. */}
        {templates.isError && <Banner tone="warning">Couldn't load your templates.</Banner>}
        {templates.data?.length === 0 && <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">No templates yet. Save a journey as a template, or create one here.</p>}
        {templates.data && templates.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {templates.data.map((t) => (
              <li key={t.id}>
                <Link to={`/trips/templates/${t.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2">
                  <Bookmark aria-hidden className="size-5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{t.name}</span>
                    <span className="block text-sm text-muted">
                      {t.fromStationCode} → {t.toStationCode} · {t.passengers.length} passenger{t.passengers.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <ArrowRight aria-hidden className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={pending !== null}
        title="Delete this journey?"
        body={pending && <>{pending.name} on {formatJourneyDate(pending.journeyDate)} will be removed.</>}
        confirmLabel="Delete journey"
        busy={del.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && del.mutate(pending.id, { onSettled: () => setPending(null) })}
      />
    </>
  );
}
