import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JourneyDraftInput, PassengerDto, PassengerInput, PassengerUpdate, StationDto, UpdateProfileInput } from "@tatkalflow/shared";
import { api } from "./api";

export interface Profile {
  id: string;
  mobile: string;
  fullName: string | null;
  email: string | null;
  preferredLanguage: string;
  timezone: string;
  notificationPreferences: { push: boolean; email: boolean; sms: boolean };
}
export interface IrctcAccount {
  linked: boolean;
  irctcUserId: string | null;
  keepSignedInPreference: boolean;
  signInMode: "manual";
  notice?: string;
}
export interface JourneyDto {
  id: string;
  fromStationCode: string;
  fromStationName: string | null;
  toStationCode: string;
  toStationName: string | null;
  journeyDate: string;
  quota: string;
  state: string;
  passengers: Array<Pick<PassengerDto, "id" | "name" | "age" | "gender" | "berthPreference">>;
}
export interface RulesStatus {
  enforcement: boolean;
  gaps: Array<{ ruleKey: string; state: "MISSING" | "UNVERIFIED" | "STALE" }>;
}
export interface StationSearchResult {
  datasetVersion: string | null;
  results: StationDto[];
}

export const keys = {
  me: ["me"] as const,
  irctc: ["irctc"] as const,
  passengers: ["passengers"] as const,
  journeys: ["journeys"] as const,
  myStations: ["stations", "mine"] as const,
  stationSearch: (q: string) => ["stations", "search", q] as const,
  rules: ["rules"] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api<Profile>("/api/me") });
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api<Profile>("/api/me", { method: "PATCH", body: input }),
    onSuccess: (p) => qc.setQueryData(keys.me, p),
  });
}

export const useIrctcAccount = () => useQuery({ queryKey: keys.irctc, queryFn: () => api<IrctcAccount>("/api/me/irctc-account") });
export function useSaveIrctcAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { irctcUserId: string; keepSignedInPreference: boolean }) => api<IrctcAccount>("/api/me/irctc-account", { method: "PUT", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.irctc }),
  });
}
export function useRemoveIrctcAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/api/me/irctc-account", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.irctc }),
  });
}

export const usePassengers = () => useQuery({ queryKey: keys.passengers, queryFn: () => api<PassengerDto[]>("/api/passengers") });
export function useCreatePassenger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PassengerInput) => api<PassengerDto>("/api/passengers", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.passengers }),
  });
}
export function useUpdatePassenger(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PassengerUpdate) => api<PassengerDto>(`/api/passengers/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.passengers }),
  });
}
export function useDeletePassenger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/passengers/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.passengers }),
  });
}

export const useJourneys = () => useQuery({ queryKey: keys.journeys, queryFn: () => api<JourneyDto[]>("/api/journeys") });
export function useCreateJourney() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JourneyDraftInput) => api<{ journey: JourneyDto; warnings: string[] }>("/api/journeys", { method: "POST", body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.journeys });
      void qc.invalidateQueries({ queryKey: keys.passengers });
      void qc.invalidateQueries({ queryKey: keys.myStations });
    },
  });
}
export function useDeleteJourney() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/journeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.journeys }),
  });
}

export const useMyStations = () =>
  useQuery({ queryKey: keys.myStations, queryFn: () => api<{ favourites: StationDto[]; recents: StationDto[] }>("/api/stations/mine") });
export function useStationSearch(q: string) {
  return useQuery({
    queryKey: keys.stationSearch(q),
    queryFn: () => api<StationSearchResult>(`/api/stations/search?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.trim().length > 0,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}
export function useToggleFavourite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, favourite }: { code: string; favourite: boolean }) =>
      api<void>(`/api/stations/favourites/${encodeURIComponent(code)}`, { method: favourite ? "PUT" : "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.myStations }),
  });
}

export const useRulesStatus = () => useQuery({ queryKey: keys.rules, queryFn: () => api<RulesStatus>("/api/rules/active"), staleTime: 10 * 60_000 });
