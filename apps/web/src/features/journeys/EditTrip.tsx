import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { ErrorState, PageHeader, Spinner } from "../../components/ui";
import { useJourney, useUpdateJourney } from "../../lib/queries";
import { draftFromConfig, toJourneyUpdate } from "./editor/draft";
import { JourneyEditor } from "./editor/JourneyEditor";

export default function EditTrip() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const journey = useJourney(id);
  const update = useUpdateJourney(id);
  return (
    <>
      <Link to={`/trips/${id}`} className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted">
        <ArrowLeft aria-hidden className="size-4" /> Journey
      </Link>
      <PageHeader title="Edit journey" />
      {journey.isPending && <Spinner label="Loading journey" />}
      {journey.isError && <ErrorState message="Couldn't load this journey." onRetry={() => void journey.refetch()} />}
      {journey.data && journey.data.state !== "DRAFT" && <ErrorState message="This journey can no longer be changed." />}
      {journey.data?.state === "DRAFT" && (
        <JourneyEditor
          mode="journey"
          initial={draftFromConfig(journey.data)}
          submitLabel="Save changes"
          onSubmit={async (d) => {
            await update.mutateAsync(toJourneyUpdate(d));
            navigate(`/trips/${id}`, { state: { saved: true } });
          }}
        />
      )}
    </>
  );
}
