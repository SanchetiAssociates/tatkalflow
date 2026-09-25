import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Banner, Button, Field, Input } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { useUpdateMe } from "../../lib/queries";
import { OnboardingSteps } from "./Steps";

export default function AccountReady() {
  const navigate = useNavigate();
  const update = useUpdateMe();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (name.trim()) await update.mutateAsync({ fullName: name.trim() });
      navigate("/onboarding/passenger");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your name.");
    }
  }

  return (
    <section className="animate-rise flex flex-1 flex-col gap-6">
      <OnboardingSteps current={0} />
      <div className="flex flex-col items-start gap-3">
        <CheckCircle2 aria-hidden className="size-12 text-success" />
        <h1 className="text-2xl font-bold tracking-tight">Your account is ready.</h1>
        <p className="text-muted">Next, save the people you travel with, then plan your first journey. It takes about a minute.</p>
      </div>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-5">
        <Field label="What should we call you?" htmlFor="fullName" hint="Optional. Used for greetings only.">
          <Input id="fullName" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        {error && <Banner tone="danger">{error}</Banner>}
        <Button type="submit" block loading={update.isPending} className="mt-auto">
          Continue
        </Button>
      </form>
    </section>
  );
}
