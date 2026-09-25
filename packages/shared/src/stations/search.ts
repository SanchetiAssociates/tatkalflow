/**
 * Portable, dependency-free station search used by both the API and the
 * offline web app. No database extensions (pg_trgm etc.) are needed.
 *
 * Ranking, best first:
 *   exact code > code prefix > name prefix > word prefixes > substring > fuzzy
 * Fuzzy matching tolerates typos per word (1 edit for 4+ letters, 2 for 7+),
 * using optimal-string-alignment distance (transpositions count as 1).
 */

export interface SearchableStation {
  code: string;
  name: string;
  state?: string | null;
  aliases?: readonly string[];
}

interface IndexedStation<T extends SearchableStation> {
  station: T;
  code: string;
  names: { text: string; tokens: string[]; isAlias: boolean }[];
}

export interface StationIndex<T extends SearchableStation = SearchableStation> {
  readonly size: number;
  readonly entries: readonly IndexedStation<T>[];
}

export function normaliseText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildStationIndex<T extends SearchableStation>(stations: readonly T[]): StationIndex<T> {
  const entries = stations.map((station) => {
    const names = [station.name, ...(station.aliases ?? [])].map((n, i) => {
      const text = normaliseText(n);
      return { text, tokens: text.split(" ").filter(Boolean), isAlias: i > 0 };
    });
    return { station, code: station.code.toUpperCase(), names };
  });
  return { size: entries.length, entries };
}

/** Optimal string alignment distance, bounded: returns max+1 as soon as it's exceeded. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

function allowedEdits(tokenLength: number): number {
  if (tokenLength >= 7) return 2;
  if (tokenLength >= 4) return 1;
  return 0;
}

/** Best distance from query token to a station token or a same-length prefix of it (so "mumb" ~ "mumbai"). */
function tokenDistance(q: string, token: string, max: number): number {
  let best = editDistance(q, token, max);
  for (const len of [q.length - 1, q.length, q.length + 1]) {
    if (len > 0 && len < token.length) best = Math.min(best, editDistance(q, token.slice(0, len), max));
  }
  return best;
}

function scoreName(qText: string, qTokens: string[], name: { text: string; tokens: string[] }): number {
  if (name.text === qText) return 750;
  if (name.text.startsWith(qText)) return 700 - Math.min(50, name.text.length - qText.length);
  if (qTokens.every((qt) => name.tokens.some((t) => t.startsWith(qt)))) return 600;
  if (qText.length >= 3 && name.text.includes(qText)) return 400;

  // Fuzzy: every query token must be close to some station token.
  let total = 0;
  for (const qt of qTokens) {
    const max = allowedEdits(qt.length);
    if (max === 0) {
      if (!name.tokens.some((t) => t.startsWith(qt))) return 0;
      continue;
    }
    let best = max + 1;
    for (const t of name.tokens) best = Math.min(best, tokenDistance(qt, t, max));
    if (best > max) return 0;
    total += best;
  }
  return 300 - 40 * total;
}

export interface StationMatch<T extends SearchableStation> {
  station: T;
  score: number;
  matchedAlias: boolean;
}

export function searchStations<T extends SearchableStation>(
  index: StationIndex<T>,
  query: string,
  limit = 8,
): StationMatch<T>[] {
  const qText = normaliseText(query);
  if (!qText) return [];
  const qTokens = qText.split(" ");
  const qCode = query.trim().toUpperCase().replace(/\s+/g, "");

  const matches: StationMatch<T>[] = [];
  for (const entry of index.entries) {
    let score = 0;
    let matchedAlias = false;
    if (entry.code === qCode) score = 1000;
    else if (qCode.length >= 2 && entry.code.startsWith(qCode)) score = 850 - (entry.code.length - qCode.length);

    for (const name of entry.names) {
      const s = scoreName(qText, qTokens, name) - (name.isAlias ? 25 : 0);
      if (s > score) {
        score = s;
        matchedAlias = name.isAlias;
      }
    }
    if (score > 0) matches.push({ station: entry.station, score, matchedAlias });
  }

  matches.sort(
    (a, b) => b.score - a.score || a.station.name.length - b.station.name.length || a.station.code.localeCompare(b.station.code),
  );
  return matches.slice(0, limit);
}
