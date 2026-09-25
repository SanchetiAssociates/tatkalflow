import { ArrowLeft, CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Banner, Button, ButtonLink, ConfirmDialog, ErrorState, Spinner } from "../../../components/ui";
import { ApiError } from "../../../lib/api";
import { useDeleteTemplate, useJourneyFromTemplate, useJourneyTemplate } from "../../../lib/queries";
import { DateDialog } from "../DateDialog";
import { JourneySummary } from "../JourneySummary";

/** Keyed by ID so page state never carries over between templates. */
export default function TemplateDetailRoute() {
  const { id = "" } = useParams();
  return <TemplateDetail key={id} id={id} />;
}

function TemplateDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { saved?: boolean } };
  const template = useJourneyTemplate(id);
  const plan = useJourneyFromTemplate(id);
  const del = useDeleteTemplate();
  const [dialog, setDialog] = useState<"plan" | "delete" | null>(null);

  if (template.isPending) return <Spinner label="Loading template" />;
  if (template.isError) {
    const missing = template.error instanceof ApiError && template.error.status === 404;
    return <ErrorState message={missing ? "This template doesn't exist or was deleted." : "Couldn't load this template."} onRetry={missing ? undefined : () => void template.refetch()} />;
  }
  const t = template.data;

  return (
    <div className="flex flex-col gap-5">
      <Link to="/trips" className="-mb-2 inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-muted">
        <ArrowLeft aria-hidden className="size-4" /> Trips
      </Link>
      <header>
        <p className="text-sm font-semibold text-muted">Template</p>
        <h1 className="text-2xl font-bold tracking-tight">{t.name}</h1>
      </header>
      {location.state?.saved && <Banner tone="success">Template saved.</Banner>}

      <Button onClick={() => setDialog("plan")} block>
        <CalendarPlus aria-hidden className="size-5" /> Plan a journey from this template
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <ButtonLink to={`/trips/templates/${t.id}/edit`} variant="secondary" className="min-h-12 px-3">
          <Pencil aria-hidden className="size-4" /> Edit
        </ButtonLink>
        <Button variant="secondary" className="px-3 text-danger" onClick={() => setDialog("delete")}>
          <Trash2 aria-hidden className="size-4" /> Delete
        </Button>
      </div>

      <JourneySummary config={t} />

      {dialog === "plan" && (
        <DateDialog
          open
          title="Plan a journey"
          body="The journey gets its own copy of this template. Changing the template later won't change it."
          confirmLabel="Create journey"
          busy={plan.isPending}
          error={plan.error instanceof ApiError ? (plan.error.fields[0]?.message ?? plan.error.message) : null}
          onCancel={() => setDialog(null)}
          onConfirm={(journeyDate) => plan.mutate({ journeyDate }, { onSuccess: (res) => navigate(`/trips/${res.journey.id}`, { state: { saved: true } }) })}
        />
      )}
      <ConfirmDialog
        open={dialog === "delete"}
        title="Delete this template?"
        body={<>{t.name} will be removed. Journeys already created from it are not affected.</>}
        confirmLabel="Delete template"
        busy={del.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={() => del.mutate(t.id, { onSuccess: () => navigate("/trips", { replace: true }), onSettled: () => setDialog(null) })}
      />
    </div>
  );
}
