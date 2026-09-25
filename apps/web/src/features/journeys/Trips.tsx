import { Plus, TrainFront } from "lucide-react";
import { useState } from "react";
import { ButtonLink, ConfirmDialog, EmptyState, ErrorState, ListSkeleton, PageHeader } from "../../components/ui";
import { formatJourneyDate } from "../../lib/format";
import { useDeleteJourney, useJourneys, type JourneyDto } from "../../lib/queries";
import { JourneyCard } from "./JourneyCard";

export default function Trips() {
  const { data, isPending, isError, refetch } = useJourneys();
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
        <EmptyState icon={TrainFront} title="No journeys planned" action={<ButtonLink to="/trips/new" block>Schedule journey</ButtonLink>}>
          Plan a journey weeks ahead. When Tatkal scheduling is available, reminders will be set from here.
        </EmptyState>
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.map((j) => (
            <JourneyCard key={j.id} journey={j} onDelete={setPending} />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        title="Delete this journey?"
        body={pending && <>{pending.fromStationName} → {pending.toStationName} on {formatJourneyDate(pending.journeyDate)} will be removed.</>}
        confirmLabel="Delete journey"
        busy={del.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && del.mutate(pending.id, { onSettled: () => setPending(null) })}
      />
    </>
  );
}
