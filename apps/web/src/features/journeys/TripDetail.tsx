import { ArrowLeft, BookmarkPlus, Copy, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Banner, Button, ButtonLink, ConfirmDialog, ErrorState, Spinner } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { formatJourneyDate } from "../../lib/format";
import { useDeleteJourney, useDuplicateJourney, useJourney, useSaveTemplate } from "../../lib/queries";
import { DateDialog } from "./DateDialog";
import { draftFromConfig, toTemplateInput } from "./editor/draft";
import { JourneySummary } from "./JourneySummary";
import { ReadinessPanel } from "./ReadinessPanel";

export default function TripDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { saved?: boolean; warnings?: string[] } };
  const journey = useJourney(id);
  const del = useDeleteJourney();
  const duplicate = useDuplicateJourney(id);
  const saveTemplate = useSaveTemplate();
  const [dialog, setDialog] = useState<"delete" | "duplicate" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [templateSaved, setTemplateSaved] = useState(false);

  if (journey.isPending) return <Spinner label="Loading journey" />;
  if (journey.isError) {
    const missing = journey.error instanceof ApiError && journey.error.status === 404;
    return <ErrorState message={missing ? "This journey doesn't exist or was deleted." : "Couldn't load this journey."} onRetry={missing ? undefined : () => void journey.refetch()} />;
  }
  const j = journey.data;
  const editable = j.state === "DRAFT";

  return (
    <div className="flex flex-col gap-5">
      <Link to="/trips" className="-mb-2 inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-muted">
        <ArrowLeft aria-hidden className="size-4" /> Trips
      </Link>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{j.name}</h1>
        <p className="mt-1 text-muted">
          {j.fromStationCode} → {j.toStationCode} · {formatJourneyDate(j.journeyDate)}
        </p>
      </header>

      {location.state?.saved && <Banner tone="success">Journey saved.</Banner>}
      {location.state?.warnings?.map((w) => (
        <Banner key={w} tone="warning">
          {w}
        </Banner>
      ))}
      {templateSaved && <Banner tone="success">Saved as a template. Find it under Trips → Templates.</Banner>}
      {actionError && <Banner tone="danger">{actionError}</Banner>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {editable && (
          <ButtonLink to={`/trips/${j.id}/edit`} variant="secondary" className="min-h-12 px-3">
            <Pencil aria-hidden className="size-4" /> Edit
          </ButtonLink>
        )}
        <Button variant="secondary" className="px-3" onClick={() => setDialog("duplicate")}>
          <Copy aria-hidden className="size-4" /> Duplicate
        </Button>
        <Button
          variant="secondary"
          className="px-3"
          loading={saveTemplate.isPending}
          onClick={() => {
            setActionError(null);
            saveTemplate.mutate(toTemplateInput({ ...draftFromConfig(j), name: j.name }), {
              onSuccess: () => setTemplateSaved(true),
              onError: (e) => setActionError(e instanceof ApiError ? e.message : "Couldn't save the template."),
            });
          }}
        >
          <BookmarkPlus aria-hidden className="size-4" /> Save as template
        </Button>
        <Button variant="secondary" className="px-3 text-danger" onClick={() => setDialog("delete")}>
          <Trash2 aria-hidden className="size-4" /> Delete
        </Button>
      </div>

      <ReadinessPanel report={j.readiness} />
      <JourneySummary config={j} journeyDate={j.journeyDate} ruleSnapshot={j.ruleSnapshot} />

      <ConfirmDialog
        open={dialog === "delete"}
        title="Delete this journey?"
        body={<>{j.name} on {formatJourneyDate(j.journeyDate)} will be removed.</>}
        confirmLabel="Delete journey"
        busy={del.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={() => del.mutate(j.id, { onSuccess: () => navigate("/trips", { replace: true }), onSettled: () => setDialog(null) })}
      />
      {dialog === "duplicate" && (
        <DateDialog
          open
          title="Duplicate journey"
          body="The copy keeps the route, trains, classes, passengers and preferences."
          confirmLabel="Duplicate"
          initialDate={j.journeyDate}
          busy={duplicate.isPending}
          error={duplicate.error instanceof ApiError ? (duplicate.error.fields[0]?.message ?? duplicate.error.message) : null}
          onCancel={() => setDialog(null)}
          onConfirm={(journeyDate) =>
            duplicate.mutate(
              { journeyDate },
              { onSuccess: (res) => navigate(`/trips/${res.journey.id}`, { state: { saved: true, warnings: res.warnings.filter((w) => w.includes("left out")) } }) },
            )
          }
        />
      )}
    </div>
  );
}
