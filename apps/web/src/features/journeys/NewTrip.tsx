import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "../../components/ui";
import { useCreateJourney } from "../../lib/queries";
import { emptyDraft, toJourneyCreate } from "./editor/draft";
import { JourneyEditor } from "./editor/JourneyEditor";

export default function NewTrip() {
  const navigate = useNavigate();
  const create = useCreateJourney();
  return (
    <>
      <Link to="/trips" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted">
        <ArrowLeft aria-hidden className="size-4" /> Trips
      </Link>
      <PageHeader title="Plan a journey" subtitle="A few short steps. Only the route, date, a class and passengers are needed." />
      <JourneyEditor
        mode="journey"
        initial={emptyDraft()}
        submitLabel="Save journey"
        onSubmit={async (d) => {
          const saved = await create.mutateAsync(toJourneyCreate(d));
          navigate(`/trips/${saved.journey.id}`, { state: { saved: true } });
        }}
      />
    </>
  );
}
