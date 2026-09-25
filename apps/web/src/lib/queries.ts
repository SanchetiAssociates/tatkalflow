import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  JourneyConfigDto,
  JourneyCreateInput,
  JourneyDetailDto,
  JourneyDraftInput,
  JourneyDto,
  JourneyDuplicateInput,
  JourneyFromTemplateInput,
  JourneyOptionsDto,
  JourneyTemplateInput,
  JourneyTemplateUpdate,
  JourneyUpdate,
  PassengerDto,
  PassengerInput,
  PassengerUpdate,
  StationDto,
  TrainSearchResult,
  UpdateProfileInput,
} from "@tatkalflow/shared";
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
export type { JourneyDetailDto, JourneyDto };
export type JourneyTemplateDto = JourneyConfigDto;
export interface JourneySaved {
  journey: JourneyDetailDto;
  warnings: string[];
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
  journey: (id: string) => ["journeys", id] as const,
  templates: ["journey-templates"] as const,
  template: (id: string) => ["journey-templates", id] as const,
  journeyOptions: ["journey-options"] as const,
  trainSearch: (q: string, from?: string, to?: string) => ["trains", "search", q, from ?? "", to ?? ""] as const,
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
export const useJourney = (id: string) =>
  useQuery({ queryKey: keys.journey(id), queryFn: () => api<JourneyDetailDto>(`/api/journeys/${encodeURIComponent(id)}`) });

/** Journey writes refresh journeys, passengers (last used) and recent stations. */
function useJourneyMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation<O, Error, I>({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.journeys });
      void qc.invalidateQueries({ queryKey: keys.passengers });
      void qc.invalidateQueries({ queryKey: keys.myStations });
    },
  });
}
export const useCreateJourney = () =>
  useJourneyMutation((input: JourneyDraftInput | JourneyCreateInput) => api<JourneySaved>("/api/journeys", { method: "POST", body: input }));
export const useUpdateJourney = (id: string) =>
  useJourneyMutation((input: JourneyUpdate) => api<JourneyDetailDto>(`/api/journeys/${encodeURIComponent(id)}`, { method: "PATCH", body: input }));
export const useDuplicateJourney = (id: string) =>
  useJourneyMutation((input: JourneyDuplicateInput) => api<JourneySaved>(`/api/journeys/${encodeURIComponent(id)}/duplicate`, { method: "POST", body: input }));
export function useDeleteJourney() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/journeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.journeys }),
  });
}

export const useJourneyOptions = () =>
  useQuery({ queryKey: keys.journeyOptions, queryFn: () => api<JourneyOptionsDto>("/api/journey-options"), staleTime: 10 * 60_000 });

export const useJourneyTemplates = () => useQuery({ queryKey: keys.templates, queryFn: () => api<JourneyTemplateDto[]>("/api/journey-templates") });
export const useJourneyTemplate = (id: string) =>
  useQuery({ queryKey: keys.template(id), queryFn: () => api<JourneyTemplateDto>(`/api/journey-templates/${encodeURIComponent(id)}`), enabled: id !== "" });
export function useSaveTemplate(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JourneyTemplateInput | JourneyTemplateUpdate) =>
      id
        ? api<JourneyTemplateDto>(`/api/journey-templates/${encodeURIComponent(id)}`, { method: "PATCH", body: input })
        : api<JourneyTemplateDto>("/api/journey-templates", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.templates }),
  });
}
export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/journey-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.templates }),
  });
}
export function useJourneyFromTemplate(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JourneyFromTemplateInput) =>
      api<JourneySaved>(`/api/journey-templates/${encodeURIComponent(templateId)}/journeys`, { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.journeys }),
  });
}

export function useTrainSearch(q: string, from?: string, to?: string) {
  const params = new URLSearchParams({ q, limit: "8" });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return useQuery({
    queryKey: keys.trainSearch(q, from, to),
    queryFn: () => api<TrainSearchResult>(`/api/trains/search?${params.toString()}`),
    enabled: q.trim().length > 0,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
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
