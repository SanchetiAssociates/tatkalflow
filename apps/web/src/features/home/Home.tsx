import { CalendarPlus, TrainFront, UserPlus } from "lucide-react";
import { Banner, ButtonLink, EmptyState, ErrorState, ListSkeleton } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { greeting } from "../../lib/format";
import { useJourneys, useMe, usePassengers, useRulesStatus } from "../../lib/queries";
import { JourneyCard } from "../journeys/JourneyCard";
import { InstallCard } from "../profile/InstallCard";

export default function Home() {
  const { state } = useAuth();
  const me = useMe();
  const journeys = useJourneys();
  const passengers = usePassengers();
  const rules = useRulesStatus();
  const name = me.data?.fullName?.split(" ")[0] ?? state.user?.fullName?.split(" ")[0];
  const upcoming = journeys.data?.slice(0, 3) ?? [];
  const timingUnverified = rules.data?.gaps.some((g) => g.ruleKey.includes("opening_time") || g.ruleKey === "tatkal.advance_days");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-muted">{greeting()}</p>
        <h1 className="text-3xl font-bold tracking-tight">{name ? `${name}` : "Welcome"}</h1>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <ButtonLink to="/trips/new" className="min-h-14">
          <CalendarPlus aria-hidden className="size-5" /> Schedule journey
        </ButtonLink>
        <ButtonLink to="/passengers/new" variant="secondary" className="min-h-14">
          <UserPlus aria-hidden className="size-5" /> Add passenger
        </ButtonLink>
      </div>

      {timingUnverified && (
        <Banner tone="warning" title="Tatkal timings not yet verified">
          The opening-time rules in this app haven't been checked against an official IRCTC source yet. Always confirm the booking window on IRCTC.
        </Banner>
      )}

      <section aria-labelledby="upcoming-title" className="flex flex-col gap-3">
        <h2 id="upcoming-title" className="text-lg font-semibold">
          Upcoming
        </h2>
        {journeys.isPending && <ListSkeleton rows={2} label="Loading journeys" />}
        {journeys.isError && <ErrorState message="Couldn't load your journeys." onRetry={() => void journeys.refetch()} />}
        {journeys.data?.length === 0 && (
          <EmptyState icon={TrainFront} title="Nothing planned yet">
            {passengers.data?.length ? "Schedule a journey and it will show up here." : "Add a passenger, then schedule your first journey."}
          </EmptyState>
        )}
        {upcoming.length > 0 && (
          <ul className="flex flex-col gap-3">
            {upcoming.map((j) => (
              <JourneyCard key={j.id} journey={j} />
            ))}
          </ul>
        )}
      </section>

      <InstallCard />
    </div>
  );
}
