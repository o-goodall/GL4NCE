export type EventSeverity = "high" | "medium" | "low";
export type EventCategory = "violent" | "minor" | "economic" | "extremism" | "escalation";
/**
 * Computed urgency level for a country, derived from recent event severity,
 * category mix, and trending velocity.  Used for map marker sizing/colour and
 * the alert badge in the news modal.
 *
 * critical – active war / mass-casualty event trending right now
 * high     – significant violence or fast-escalating situation
 * medium   – civil unrest, armed clashes, escalation signals
 * watch    – low-level tension or minor events only
 */
export type AlertLevel = "critical" | "high" | "medium" | "watch";

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
  /** Computed urgency — see AlertLevel */
  alertLevel: AlertLevel;
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
