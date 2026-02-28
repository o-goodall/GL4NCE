export type EventSeverity = "high" | "medium" | "low";
export type EventCategory = "violent" | "minor" | "economic" | "extremism";

export interface NewsEvent {
  title: string;
  source: string;
  time: string;
  country: string;
  countryCode: string;
  severity: EventSeverity;
  category: EventCategory;
  link?: string;
}

export interface CountryNewsData {
  code: string;
  name: string;
  lat: number;
  lng: number;
  trending: boolean;
  events: NewsEvent[];
}

export interface NewsMapData {
  countries: CountryNewsData[];
  lastUpdated: string;
  /** True when the API fell back to mock data (feeds unavailable) */
  usingMockData?: boolean;
  /** How many RSS sources responded successfully vs total attempted */
  feedStats?: { succeeded: number; total: number };
  /**
   * Groups of ISO-3166 country codes that are trending together because they
   * are directly involved in the same active conflict or war.  Each inner array
   * contains ≥ 2 codes (e.g. ["IR", "IL"] for the Israel–Iran conflict).
   * Absent / empty when no interconnected conflict is detected.
   */
  conflictGroups?: string[][];
}
