import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/ui";
import { JourneyDraftForm } from "../journeys/JourneyDraftForm";
import { OnboardingSteps } from "./Steps";

export default function FirstJourney() {
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  return (
    <section className="animate-rise flex flex-1 flex-col gap-6">
      <OnboardingSteps current={2} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Create your first journey</h1>
        <p className="mt-1 text-muted">
          Where and when you want to travel. You can add preferred trains, classes and other preferences later from Trips. Booking always happens on IRCTC, where you complete sign-in, CAPTCHA, OTP and payment yourself.
        </p>
      </div>
      <JourneyDraftForm submitLabel="Save journey" onDone={() => navigate("/", { replace: true })} onSaved={() => setSaved(true)} />
      {!saved && (
        <Button variant="ghost" onClick={() => navigate("/", { replace: true })}>
          Skip for now
        </Button>
      )}
    </section>
  );
}
