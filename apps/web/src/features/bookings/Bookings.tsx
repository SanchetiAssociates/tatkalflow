import { BookOpenCheck } from "lucide-react";
import { EmptyState, PageHeader } from "../../components/ui";

export default function Bookings() {
  return (
    <>
      <PageHeader title="Bookings" subtitle="Tickets you've booked, with their PNRs." />
      <EmptyState icon={BookOpenCheck} title="No bookings yet">
        A booking appears here only after you've completed it on IRCTC and it's been confirmed with a PNR. TatkalFlow never marks a ticket as booked without that confirmation.
      </EmptyState>
    </>
  );
}
