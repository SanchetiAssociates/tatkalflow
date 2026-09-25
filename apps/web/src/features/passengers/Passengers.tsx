import type { PassengerDto } from "@tatkalflow/shared";
import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { ButtonLink, ConfirmDialog, EmptyState, ErrorState, ListSkeleton, PageHeader } from "../../components/ui";
import { useDeletePassenger, usePassengers } from "../../lib/queries";
import { PassengerCard } from "./PassengerCard";

export default function Passengers() {
  const { data, isPending, isError, refetch } = usePassengers();
  const del = useDeletePassenger();
  const [pending, setPending] = useState<PassengerDto | null>(null);

  return (
    <>
      <PageHeader
        title="Passengers"
        subtitle="Saved once, reused for every journey."
        action={
          data && data.length > 0 ? (
            <ButtonLink to="/passengers/new" variant="secondary" className="min-h-11 px-4" aria-label="Add passenger">
              <Plus aria-hidden className="size-5" /> Add
            </ButtonLink>
          ) : undefined
        }
      />
      {isPending && <ListSkeleton label="Loading passengers" />}
      {isError && <ErrorState message="Couldn't load passengers." onRetry={() => void refetch()} />}
      {data && data.length === 0 && (
        <EmptyState icon={Users} title="No passengers yet" action={<ButtonLink to="/passengers/new" block>Add passenger</ButtonLink>}>
          Add yourself and the people you usually travel with.
        </EmptyState>
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.map((p) => (
            <PassengerCard key={p.id} passenger={p} onDelete={setPending} />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        title="Delete passenger?"
        body={<>{pending?.name} will be removed from your saved passengers. Existing journeys keep their details.</>}
        confirmLabel="Delete"
        busy={del.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && del.mutate(pending.id, { onSettled: () => setPending(null) })}
      />
    </>
  );
}
