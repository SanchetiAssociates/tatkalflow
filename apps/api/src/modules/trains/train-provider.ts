import { normaliseText, type TrainDto } from "@tatkalflow/shared";

/**
 * Source of train information for preferred-train selection.
 *
 * Journeys store only the train number and a copy of its name, so a provider
 * can be swapped (e.g. for a licensed timetable dataset) without touching
 * saved journeys. TatkalFlow never scrapes IRCTC for train data.
 */
export interface TrainDataProvider {
  readonly name: string;
  /** False when no train data is configured (search returns nothing). */
  readonly available: boolean;
  /**
   * When true, a train number the provider doesn't know is rejected. When
   * false (no data source), numbers are accepted as entered.
   */
  readonly authoritative: boolean;
  search(query: string, opts?: { from?: string; to?: string; limit?: number }): Promise<TrainDto[]>;
  findByNumber(number: string): Promise<TrainDto | null>;
}

/** True/false when the provider knows the train's stops; null when it can't tell. */
export function servesRoute(train: TrainDto | null, from: string, to: string): boolean | null {
  if (!train) return null;
  const i = train.stops.indexOf(from);
  const j = train.stops.indexOf(to);
  return i !== -1 && j !== -1 && i < j;
}

/**
 * SAMPLE DATA for development and tests only. These trains are fictional
 * (numbers in the unused 90xxx range, names marked "Sample"); they are not
 * timetable data. The provider is refused in production.
 */
export const MOCK_TRAINS: readonly TrainDto[] = [
  { number: "90101", name: "Sample Western Express", fromStationCode: "BCT", toStationCode: "NDLS", stops: ["BCT", "ADI", "JP", "NDLS"], classes: ["1A", "2A", "3A", "SL"] },
  { number: "90102", name: "Sample Capital Superfast", fromStationCode: "BCT", toStationCode: "NDLS", stops: ["BCT", "ADI", "NDLS"], classes: ["1A", "2A", "3A"] },
  { number: "90103", name: "Sample Northern Mail", fromStationCode: "CSMT", toStationCode: "DLI", stops: ["CSMT", "PUNE", "LKO", "DLI"], classes: ["2A", "3A", "3E", "SL", "2S"] },
  { number: "90104", name: "Sample Deccan Link", fromStationCode: "CSMT", toStationCode: "PUNE", stops: ["CSMT", "PUNE"], classes: ["CC", "EC", "2S"] },
  { number: "90105", name: "Sample Coastal Express", fromStationCode: "BCT", toStationCode: "MAO", stops: ["BCT", "MAO"], classes: ["2A", "3A", "3E", "SL"] },
  { number: "90106", name: "Sample Eastern Express", fromStationCode: "NDLS", toStationCode: "HWH", stops: ["NDLS", "LKO", "HWH"], classes: ["1A", "2A", "3A", "SL"] },
  { number: "90107", name: "Sample Southern Express", fromStationCode: "MAS", toStationCode: "SBC", stops: ["MAS", "SBC"], classes: ["CC", "EC", "2S"] },
  { number: "90108", name: "Sample Pink City Express", fromStationCode: "JP", toStationCode: "NDLS", stops: ["JP", "NDLS"], classes: ["2A", "3A", "SL"] },
];

export class MockTrainDataProvider implements TrainDataProvider {
  readonly name = "mock";
  readonly available = true;
  readonly authoritative = true;

  constructor(private readonly trains: readonly TrainDto[] = MOCK_TRAINS) {}

  async search(query: string, opts: { from?: string; to?: string; limit?: number } = {}): Promise<TrainDto[]> {
    const q = normaliseText(query);
    const matches = this.trains.filter((t) => t.number.startsWith(query.trim()) || normaliseText(t.name).includes(q));
    // Trains that serve the chosen route come first.
    const ranked = opts.from && opts.to ? [...matches].sort((a, b) => Number(servesRoute(b, opts.from!, opts.to!)) - Number(servesRoute(a, opts.from!, opts.to!))) : matches;
    return ranked.slice(0, opts.limit ?? 8);
  }

  async findByNumber(number: string): Promise<TrainDto | null> {
    return this.trains.find((t) => t.number === number) ?? null;
  }
}

/** No train data source: search is empty and numbers are stored as entered. */
export class NoTrainDataProvider implements TrainDataProvider {
  readonly name = "none";
  readonly available = false;
  readonly authoritative = false;

  async search(): Promise<TrainDto[]> {
    return [];
  }

  async findByNumber(): Promise<TrainDto | null> {
    return null;
  }
}

export function createTrainDataProvider(name: "mock" | "none"): TrainDataProvider {
  return name === "mock" ? new MockTrainDataProvider() : new NoTrainDataProvider();
}
