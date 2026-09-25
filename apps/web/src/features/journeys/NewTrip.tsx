import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "../../components/ui";
import { JourneyDraftForm } from "./JourneyDraftForm";

export default function NewTrip() {
  const navigate = useNavigate();
  return (
    <>
      <Link to="/trips" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted">
        <ArrowLeft aria-hidden className="size-4" /> Trips
      </Link>
      <PageHeader title="Schedule journey" subtitle="Route, date and passengers. More preferences are coming soon." />
      <JourneyDraftForm onDone={() => navigate("/trips")} />
    </>
  );
}
