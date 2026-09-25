import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { ErrorState, PageHeader, Spinner } from "../../../components/ui";
import { useJourneyTemplate, useSaveTemplate } from "../../../lib/queries";
import { draftFromConfig, emptyDraft, toTemplateInput } from "../editor/draft";
import { JourneyEditor } from "../editor/JourneyEditor";

/** Create (no :id) or edit (with :id) a journey template. */
export default function TemplateEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const template = useJourneyTemplate(id ?? ""); // disabled when creating
  const save = useSaveTemplate(id);
  const editing = Boolean(id);

  const editor = (initial: ReturnType<typeof emptyDraft>) => (
    <JourneyEditor
      mode="template"
      initial={initial}
      submitLabel={editing ? "Save changes" : "Save template"}
      onSubmit={async (d) => {
        const t = await save.mutateAsync(toTemplateInput(d));
        navigate(`/trips/templates/${t.id}`, { state: { saved: true } });
      }}
    />
  );

  return (
    <>
      <Link to={editing ? `/trips/templates/${id}` : "/trips"} className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted">
        <ArrowLeft aria-hidden className="size-4" /> {editing ? "Template" : "Trips"}
      </Link>
      <PageHeader title={editing ? "Edit template" : "New template"} subtitle="A reusable journey setup without a date. Journeys made from it keep their own copy." />
      {!editing && editor(emptyDraft())}
      {editing && template.isPending && <Spinner label="Loading template" />}
      {editing && template.isError && <ErrorState message="Couldn't load this template." onRetry={() => void template.refetch()} />}
      {editing && template.data && editor(draftFromConfig(template.data))}
    </>
  );
}
