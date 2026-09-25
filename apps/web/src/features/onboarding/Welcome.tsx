import { BellRing, CheckCircle2, ShieldCheck, TrainFront, Users } from "lucide-react";
import { useState } from "react";
import { Button, ButtonLink } from "../../components/ui";

const POINTS = [
  { icon: Users, title: "Save passengers once", body: "Names, ages and berth preferences, ready for every trip." },
  { icon: TrainFront, title: "Plan journeys ahead", body: "Save routes and travel dates weeks in advance." },
  { icon: BellRing, title: "Reminders before Tatkal opens", body: "We work out when the booking window opens and remind you in time." },
  {
    icon: ShieldCheck,
    title: "You stay in control on IRCTC",
    body: "You sign in to IRCTC and complete CAPTCHA, OTP and payment yourself. TatkalFlow never does these for you.",
  },
];

export default function Welcome() {
  const [step, setStep] = useState<0 | 1>(0);

  if (step === 0) {
    return (
      <section className="animate-rise flex flex-1 flex-col justify-between gap-10">
        <div className="mt-16 flex flex-col items-start gap-5">
          <img src="/icons/icon.svg" alt="" width={72} height={72} className="rounded-2xl" />
          <h1 className="text-4xl font-bold tracking-tight">
            Tatkal<span className="text-accent">Flow</span>
          </h1>
          <p className="text-2xl font-semibold leading-snug">Be Ready When Tatkal Opens.</p>
          <p className="text-muted">Journey planning and Tatkal preparation, with reminders so you don't miss the booking window.</p>
        </div>
        <div className="flex flex-col gap-3">
          <Button block onClick={() => setStep(1)}>
            Get started
          </Button>
          <p className="text-center text-xs text-muted">Independent app. Not affiliated with IRCTC or Indian Railways.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="animate-rise flex flex-1 flex-col gap-6" aria-labelledby="how-title">
      <h1 id="how-title" className="text-2xl font-bold tracking-tight">
        How TatkalFlow helps
      </h1>
      <ul className="flex flex-col gap-4">
        {POINTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-primary">
              <Icon aria-hidden className="size-5" />
            </span>
            <div>
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">
        <p className="flex items-center gap-2 font-semibold text-text">
          <CheckCircle2 aria-hidden className="size-4" /> Good to know
        </p>
        <p className="mt-1">
          Tatkal seats are limited and sell out quickly. TatkalFlow helps you get ready. It can't reserve seats or promise that a ticket will be available.
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-3">
        <ButtonLink to="/login" block>
          Continue with mobile number
        </ButtonLink>
        <Button variant="ghost" onClick={() => setStep(0)}>
          Back
        </Button>
      </div>
    </section>
  );
}
