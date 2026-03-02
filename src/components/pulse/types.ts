/**
 * Pulse tile types.
 *
 * PulseCategory extends the flashpoint EventCategory with additional
 * categories that are specific to the general-news Pulse feed.
 * The existing flashpoint categories are reused unchanged so there is
 * no duplication of classification logic.
 */

export type { EventCategory, EventSeverity } from "../news-map/types";

/** Categories that exist only in the Pulse feed (not in Flashpoint). */
export type PulseOnlyCategory =
  | "human_rights"  // Human-rights violations, civil liberties
  | "migration"     // Migration, asylum seekers, refugee crises
  | "geopolitics"   // Political shifts, power dynamics, alliances
  | "energy"        // Energy crises, fossil fuels, renewables
  | "crypto"        // Cryptocurrency, blockchain, DeFi
  | "technology"    // AI breakthroughs, space, tech innovation
  | "ai_ethics";    // AI regulation, ethics, privacy

/**
 * Full set of categories available in the Pulse feed.
 * Superset of the Flashpoint EventCategory — all existing flashpoint
 * categories are valid here so the shared classifier is reused directly.
 */
export type PulseCategory =
  // ── Inherited from Flashpoint (same classifier, no duplication) ────────────
  | "violent"
  | "terrorism"
  | "military"
  | "escalation"
  | "diplomatic"
  | "extremism"
  | "economic"
  | "commodities"
  | "cyber"
  | "health"
  | "environmental"
  | "disaster"
  | "infrastructure"
  | "crime"
  | "piracy"
  | "protest"
  | "minor"
  // ── Pulse-only additions ───────────────────────────────────────────────────
  | PulseOnlyCategory;

export interface PulseArticle {
  title: string;
  source: string;
  /** ISO 8601 timestamp */
  time: string;
  category: PulseCategory;
  link?: string;
  /** Best-effort thumbnail URL extracted from RSS media fields */
  image?: string;
  /** Article author from dc:creator / <author> RSS tag */
  author?: string;
  /** Short article excerpt (plain text, ≤ 200 chars) */
  description?: string;
}

export interface PulseData {
  articles: PulseArticle[];
  lastUpdated: string;
  /** Feed health — how many sources responded successfully */
  feedStats?: { succeeded: number; total: number };
}

/**
 * Category groups for the Pulse UI, matching the structure defined in the
 * product requirements.  Each group contains one or more PulseCategory values.
 */
export const PULSE_CATEGORY_GROUPS: {
  label: string;
  categories: PulseCategory[];
}[] = [
  {
    label: "Global Security & Conflict",
    categories: ["violent", "terrorism", "military", "escalation", "piracy", "extremism"],
  },
  {
    label: "Social & Political",
    categories: ["protest", "diplomatic", "human_rights", "migration", "geopolitics"],
  },
  {
    label: "Disasters & Health",
    categories: ["disaster", "health", "environmental"],
  },
  {
    label: "Economic & Financial",
    categories: ["economic", "commodities", "energy", "crypto"],
  },
  {
    label: "Technology & Innovation",
    categories: ["technology", "cyber", "ai_ethics"],
  },
  {
    label: "Infrastructure & Crime",
    categories: ["infrastructure", "crime"],
  },
];

/** Short labels for the horizontal scroll tabs on mobile. */
export const PULSE_GROUP_SHORT_LABEL: Record<string, string> = {
  "Global Security & Conflict": "Security",
  "Social & Political":         "Social",
  "Disasters & Health":         "Health",
  "Economic & Financial":       "Economy",
  "Technology & Innovation":    "Tech",
  "Infrastructure & Crime":     "Crime",
};
export const PULSE_CATEGORY_LABEL: Record<PulseCategory, string> = {
  // Flashpoint-inherited
  violent:        "Conflict",
  terrorism:      "Terrorism",
  military:       "Military",
  escalation:     "Escalation",
  diplomatic:     "Diplomatic",
  extremism:      "Extremism",
  economic:       "Economic",
  commodities:    "Commodities",
  cyber:          "Cyber",
  health:         "Health",
  environmental:  "Environmental",
  disaster:       "Disaster",
  infrastructure: "Infrastructure",
  crime:          "Crime",
  piracy:         "Piracy",
  protest:        "Protest",
  minor:          "General",
  // Pulse-only
  human_rights:   "Human Rights",
  migration:      "Migration",
  geopolitics:    "Geopolitics",
  energy:         "Energy",
  crypto:         "Crypto",
  technology:     "Technology",
  ai_ethics:      "AI Ethics",
};
