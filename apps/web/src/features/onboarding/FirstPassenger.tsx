import { useNavigate } from "react-router";
import { Button } from "../../components/ui";
import { PassengerForm } from "../passengers/PassengerForm";
import { OnboardingSteps } from "./Steps";

export default function FirstPassenger() {
  const navigate = useNavigate();
  return (
    <section className="animate-rise flex flex-1 flex-col gap-6">
      <OnboardingSteps current={1} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add your first passenger</h1>
        <p className="mt-1 text-muted">Usually yourself. You can add family members later from the Passengers tab.</p>
      </div>
      <PassengerForm submitLabel="Save and continue" onSaved={() => navigate("/onboarding/journey")} />
      <Button variant="ghost" onClick={() => navigate("/onboarding/journey")}>
        Skip for now
      </Button>
    </section>
  );
}
