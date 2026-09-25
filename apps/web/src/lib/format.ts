import { BERTH_LABELS, GENDER_LABELS, type PassengerDto } from "@tatkalflow/shared";

/** Journey dates are calendar dates (YYYY-MM-DD) — format without timezone shifts. */
export function formatJourneyDate(ymd: string, style: "long" | "short" = "long"): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: style === "long" ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: style === "long" ? "numeric" : undefined,
  }).format(d);
}

export function passengerSummary(p: Pick<PassengerDto, "age" | "gender">): string {
  return `${p.age} • ${GENDER_LABELS[p.gender]}`;
}

export function berthSummary(p: Pick<PassengerDto, "berthPreference">): string {
  return p.berthPreference === "NO_PREFERENCE" ? "Any berth" : `${BERTH_LABELS[p.berthPreference]} berth`;
}

export function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
