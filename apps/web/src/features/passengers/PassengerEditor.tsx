import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { ErrorState, PageHeader, Spinner } from "../../components/ui";
import { usePassengers } from "../../lib/queries";
import { PassengerForm } from "./PassengerForm";

export default function PassengerEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isPending } = usePassengers();
  const existing = id ? data?.find((p) => p.id === id) : undefined;

  return (
    <>
      <Link to="/passengers" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted">
        <ArrowLeft aria-hidden className="size-4" /> Passengers
      </Link>
      <PageHeader title={id ? "Edit passenger" : "Add passenger"} />
      {id && isPending && <Spinner />}
      {id && !isPending && !existing && <ErrorState message="Passenger not found." />}
      {(!id || existing) && <PassengerForm key={existing?.id ?? "new"} existing={existing} onSaved={() => navigate("/passengers")} />}
    </>
  );
}
