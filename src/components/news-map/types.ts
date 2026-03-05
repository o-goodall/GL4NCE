export type EventSeverity = "high" | "medium" | "low";

/**
 * Operational status of a known conflict zone, derived from the curated
 * static conflicts database (ACLED / UCDP / CFR / UN OCHA / DoD).
 */
export type ConflictStatus =
  | "active"
  | "escalating"
  | "ceasefire"
  | "frozen"
  | "low-intensity";

export type EventCategory =
  | "violent"       // active armed conflict / generic violence
  | "terrorism"     // terrorism, suicide attacks, car bombs
  | "military"      // military operations, offensives, exercises
  | "escalation"    // pre-conflict signals, coups, WMD threats
  | "diplomatic"    // peace talks, summits, diplomatic breakdowns
  | "extremism"     // ideologically motivated hate / extremist movements
  | "economic"      // financial crises, market crashes, sanctions
  | "commodities"   // food, energy and resource supply shocks
  | "cyber"         // cyberattacks, ransomware, state-sponsored hacking
  | "health"        // pandemics, disease outbreaks, health emergencies
  | "environmental" // climate disasters, wildfires, major ecological events
  | "disaster"      // natural disasters — earthquakes, tsunamis, hurricanes
  | "infrastructure"// attacks or failures of critical infrastructure
  | "crime"         // organised crime, cartels, gang warfare
  | "piracy"        // maritime piracy, vessel seizures
  | "protest"       // civil demonstrations, strikes, civil unrest
  | "minor";        // low-level / context events not covered above
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
  /** Attribution score from the country-detection engine (higher = more confident match) */
  score?: number;
  /** Confidence value derived from the margin between the top-scored country and the runner-up */
  confidence?: number;
  /** Number of distinct sources that independently reported this story (≥ 2 = cross-confirmed) */
  confirmations?: number;
}

export interface CountryNewsData {
  code: string;
  name: string;
  lat: number;
  lng: number;
  trending: boolean;
  /** 1-based rank among trending countries (1 = most trending); undefined for non-trending */
  trendingRank?: number;
  /** Computed urgency — see AlertLevel */
  alertLevel: AlertLevel;
  events: NewsEvent[];
  /** Weighted event-density score over the rolling 7-day window (higher = more sustained activity) */
  escalationIndex?: number;
  /**
   * Name of the primary known conflict associated with this country, sourced from the
   * static conflict database (ACLED / UCDP / CFR / UN OCHA / DoD).
   * Present only when a curated conflict entry exists for this country.
   */
  conflictName?: string;
  /**
   * Operational status of the known conflict (active / escalating / ceasefire / etc.).
   * Sourced from the curated static database, not inferred from live RSS events.
   */
  conflictStatus?: ConflictStatus;
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
  /**
   * Canonical list of data sources that contributed to this snapshot.
   * Combines live RSS/Telegram/Reddit feeds with the curated static conflict
   * database (ACLED, CFR, UCDP, UN OCHA, DoD).
   */
  dataSources?: string[];
}
