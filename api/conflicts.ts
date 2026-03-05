/**
 * Static curated conflict database.
 *
 * Compiled from authoritative open-source intelligence sources:
 *   • ACLED  — Armed Conflict Location & Event Data (acleddata.com)
 *   • CFR    — Council on Foreign Relations Global Conflict Tracker (cfr.org)
 *   • UCDP   — Uppsala Conflict Data Program (ucdp.uu.se)
 *   • UN OCHA— United Nations Office for the Coordination of Humanitarian Affairs
 *   • DoD    — U.S. Department of Defense conflict assessments
 *
 * This dataset serves as a persistent *baseline* layer on the Flashpoints map.
 * It ensures that well-documented, long-running conflicts remain visible even
 * during periods of low RSS coverage, supplementing the live news feed.
 *
 * Update cadence: review quarterly or when a major status change occurs.
 */

/** Broad category for how a conflict is organised */
export type ConflictType =
  | "interstate"   // armed conflict between two or more sovereign states
  | "civil"        // internal armed conflict (government vs. non-state actors)
  | "insurgency"   // armed rebellion / guerrilla campaign against a government
  | "proxy"        // conflict involving third-party state sponsors
  | "territorial"; // dispute over a specific territory or border

/**
 * Current operational status of a conflict.
 * These map loosely to UCDP's "active armed conflict" definitions:
 *   active        — ≥ 25 battle deaths in the current calendar year
 *   escalating    — active AND a measurable upward trend in events/casualties
 *   ceasefire     — formal or informal cessation of major hostilities
 *   frozen        — no active fighting but unresolved political status
 *   low-intensity — sporadic incidents below the 25-death UCDP threshold
 */
export type ConflictStatus =
  | "active"
  | "escalating"
  | "ceasefire"
  | "frozen"
  | "low-intensity";

export interface StaticConflict {
  /**
   * Primary country ISO-3166-1 alpha-2 code (the territory where fighting occurs).
   * For interstate conflicts this is the code most frequently cited in news.
   */
  code: string;
  /** Human-readable conflict name used in the UI */
  name: string;
  /**
   * ISO codes of all parties directly involved.
   * Listed in conflict-group priority order (most to least active).
   */
  parties: string[];
  /** Conflict category */
  type: ConflictType;
  /** Current operational status */
  status: ConflictStatus;
  /**
   * Baseline alert level for the primary country when live RSS coverage is
   * absent.  Does not override a higher level derived from real-time events.
   */
  baselineSeverity: "high" | "medium" | "low";
  /** Year hostilities began (UCDP onset year where available) */
  startYear: number;
  /** One-sentence description shown in the UI tooltip */
  summary: string;
  /** Authoritative sources that document this conflict */
  dataSources: string[];
}

/**
 * Curated list of ongoing or recently active conflicts.
 * Ordered roughly by current casualty rate / global significance.
 */
export const STATIC_CONFLICTS: readonly StaticConflict[] = [
  // ── Active Wars / High-Intensity ─────────────────────────────────────────────
  {
    code: "UA",
    name: "Russia–Ukraine War",
    parties: ["RU", "UA"],
    type: "interstate",
    status: "active",
    baselineSeverity: "high",
    startYear: 2022,
    summary: "Full-scale Russian invasion of Ukraine; ongoing artillery, missile and drone exchanges across the front line.",
    dataSources: ["ACLED", "UCDP", "UN OCHA", "DoD"],
  },
  {
    code: "PS",
    name: "Israel–Gaza War",
    parties: ["IL", "PS"],
    type: "proxy",
    status: "active",
    baselineSeverity: "high",
    startYear: 2023,
    summary: "Large-scale Israeli military operations in Gaza following the Hamas-led attacks of October 2023.",
    dataSources: ["ACLED", "UN OCHA", "CFR"],
  },
  {
    code: "SD",
    name: "Sudan Civil War",
    parties: ["SD"],
    type: "civil",
    status: "active",
    baselineSeverity: "high",
    startYear: 2023,
    summary: "Armed conflict between the Sudanese Armed Forces (SAF) and the Rapid Support Forces (RSF), causing one of the world's largest displacement crises.",
    dataSources: ["ACLED", "UN OCHA", "CFR"],
  },
  {
    code: "MM",
    name: "Myanmar Civil War",
    parties: ["MM"],
    type: "civil",
    status: "active",
    baselineSeverity: "high",
    startYear: 2021,
    summary: "Nationwide insurgency against the military junta (SAC) following the February 2021 coup; multi-front resistance by ethnic armed organisations and the People's Defence Force.",
    dataSources: ["ACLED", "UCDP", "CFR"],
  },
  {
    code: "SO",
    name: "Somalia Insurgency (Al-Shabaab)",
    parties: ["SO"],
    type: "insurgency",
    status: "active",
    baselineSeverity: "high",
    startYear: 2006,
    summary: "Al-Shabaab continues asymmetric attacks and suicide bombings against government, AU mission (ATMIS) and civilian targets.",
    dataSources: ["ACLED", "UCDP", "UN OCHA"],
  },
  {
    code: "ET",
    name: "Ethiopia – Internal Conflicts",
    parties: ["ET"],
    type: "civil",
    status: "active",
    baselineSeverity: "high",
    startYear: 2020,
    summary: "Amhara region insurgency and Oromo Liberation Army (OLA) activity persist after the 2022 Tigray ceasefire.",
    dataSources: ["ACLED", "UN OCHA", "CFR"],
  },
  {
    code: "YE",
    name: "Yemen Civil War",
    parties: ["YE", "SA"],
    type: "civil",
    status: "active",
    baselineSeverity: "high",
    startYear: 2014,
    summary: "Multi-sided civil war; Houthi (Ansar Allah) forces control northern Yemen and have conducted missile and drone strikes on Saudi Arabia and Red Sea shipping.",
    dataSources: ["ACLED", "UCDP", "UN OCHA", "CFR"],
  },
  {
    code: "CD",
    name: "DR Congo – M23 / East Congo Conflict",
    parties: ["CD"],
    type: "insurgency",
    status: "escalating",
    baselineSeverity: "high",
    startYear: 1996,
    summary: "M23 rebels (backed by Rwanda according to UN experts) have escalated operations in eastern DRC, capturing Goma in January 2025.",
    dataSources: ["ACLED", "UN OCHA", "CFR"],
  },
  {
    code: "IQ",
    name: "Iraq – Militia & ISIS Activity",
    parties: ["IQ"],
    type: "insurgency",
    status: "low-intensity",
    baselineSeverity: "medium",
    startYear: 2014,
    summary: "Residual ISIS cells conduct periodic attacks; Iran-aligned militia groups maintain armed presence and have struck US forces.",
    dataSources: ["ACLED", "UCDP", "DoD"],
  },
  {
    code: "SY",
    name: "Syrian Conflict",
    parties: ["SY"],
    type: "civil",
    status: "low-intensity",
    baselineSeverity: "medium",
    startYear: 2011,
    summary: "Post-Assad transition with continued instability; Turkish operations in the north and residual ISIS activity in the east.",
    dataSources: ["ACLED", "UCDP", "UN OCHA", "CFR"],
  },
  {
    code: "AF",
    name: "Afghanistan – Taliban Governance & IS-K",
    parties: ["AF"],
    type: "insurgency",
    status: "low-intensity",
    baselineSeverity: "medium",
    startYear: 2001,
    summary: "Islamic State Khorasan Province (IS-K) continues attacks against Taliban forces and civilian targets; Taliban consolidates control.",
    dataSources: ["UCDP", "ACLED", "DoD"],
  },
  {
    code: "ML",
    name: "Mali – Sahel Insurgency",
    parties: ["ML"],
    type: "insurgency",
    status: "active",
    baselineSeverity: "high",
    startYear: 2012,
    summary: "Jihadist groups (JNIM / ISIS-Sahel) control large rural areas; intensified after French Barkhane withdrawal and introduction of Wagner Group forces.",
    dataSources: ["ACLED", "UCDP", "UN OCHA"],
  },
  {
    code: "BF",
    name: "Burkina Faso – Sahel Insurgency",
    parties: ["BF"],
    type: "insurgency",
    status: "active",
    baselineSeverity: "high",
    startYear: 2015,
    summary: "JNIM and ISIS-Sahel control significant territory; military junta has expelled French forces and French-aligned peacekeepers.",
    dataSources: ["ACLED", "UN OCHA", "CFR"],
  },
  {
    code: "MZ",
    name: "Mozambique – Cabo Delgado Insurgency",
    parties: ["MZ"],
    type: "insurgency",
    status: "active",
    baselineSeverity: "medium",
    startYear: 2017,
    summary: "ISIS-affiliated Ansar al-Sunna Wa Jama'a (ASWJ) insurgency in Cabo Delgado threatens LNG projects; SADC mission active.",
    dataSources: ["ACLED", "UCDP"],
  },
  {
    code: "NG",
    name: "Nigeria – Boko Haram / ISWAP & Banditry",
    parties: ["NG"],
    type: "insurgency",
    status: "active",
    baselineSeverity: "high",
    startYear: 2009,
    summary: "ISWAP and Boko Haram remnants active in the northeast; armed banditry and farmer-herder clashes continue in the northwest.",
    dataSources: ["ACLED", "UCDP", "UN OCHA"],
  },
  {
    code: "CO",
    name: "Colombia – Armed Groups Conflict",
    parties: ["CO"],
    type: "insurgency",
    status: "active",
    baselineSeverity: "medium",
    startYear: 1964,
    summary: "Dissident FARC factions, ELN, and criminal organisations engage in territorial fighting; peace negotiations continue with mixed results.",
    dataSources: ["ACLED", "UCDP", "CFR"],
  },
  {
    code: "MX",
    name: "Mexico – Cartel Violence",
    parties: ["MX"],
    type: "civil",
    status: "active",
    baselineSeverity: "medium",
    startYear: 2006,
    summary: "Organised criminal groups wage ongoing territorial wars; Mexico records over 30,000 homicides annually (ACLED).",
    dataSources: ["ACLED", "CFR"],
  },
  // ── Frozen / Low-Intensity ───────────────────────────────────────────────────
  {
    code: "KP",
    name: "Korean Peninsula Tension",
    parties: ["KP", "KR"],
    type: "interstate",
    status: "frozen",
    baselineSeverity: "medium",
    startYear: 1950,
    summary: "No active combat, but North Korea regularly tests ballistic missiles and has conducted artillery provocations across the maritime border.",
    dataSources: ["CFR", "DoD"],
  },
  {
    code: "TW",
    name: "Taiwan Strait Tensions",
    parties: ["TW", "CN"],
    type: "territorial",
    status: "frozen",
    baselineSeverity: "medium",
    startYear: 1949,
    summary: "PRC conducts large-scale military exercises and grey-zone operations around Taiwan; no active armed conflict.",
    dataSources: ["DoD", "CFR"],
  },
  {
    code: "IL",
    name: "Israel–Iran / Regional Proxy Conflict",
    parties: ["IL", "IR"],
    type: "proxy",
    status: "active",
    baselineSeverity: "high",
    startYear: 2019,
    summary: "Direct missile and drone exchanges between Israel and Iran in 2024; ongoing Israeli strikes on Iranian proxy forces in Syria, Lebanon and Iraq.",
    dataSources: ["ACLED", "CFR", "DoD"],
  },
  {
    code: "LB",
    name: "Israel–Hezbollah Conflict",
    parties: ["IL", "LB"],
    type: "proxy",
    status: "ceasefire",
    baselineSeverity: "medium",
    startYear: 2023,
    summary: "Ceasefire in effect since November 2024 following intensive exchanges; Israeli and Hezbollah forces remain on alert along the border.",
    dataSources: ["UN OCHA", "CFR", "ACLED"],
  },
  {
    code: "IN",
    name: "India–Pakistan – Line of Control",
    parties: ["IN", "PK"],
    type: "territorial",
    status: "low-intensity",
    baselineSeverity: "medium",
    startYear: 1947,
    summary: "Sporadic cross-LoC firing incidents and militant infiltration attempts continue; both states are nuclear-armed.",
    dataSources: ["UCDP", "CFR", "DoD"],
  },
  {
    code: "LY",
    name: "Libya Civil War",
    parties: ["LY"],
    type: "civil",
    status: "frozen",
    baselineSeverity: "medium",
    startYear: 2014,
    summary: "Country remains divided between Tripoli-based GNU and Tobruk/LNA governments; periodic clashes despite 2020 ceasefire.",
    dataSources: ["ACLED", "UN OCHA", "CFR"],
  },
  {
    code: "SS",
    name: "South Sudan Civil War",
    parties: ["SS"],
    type: "civil",
    status: "low-intensity",
    baselineSeverity: "medium",
    startYear: 2013,
    summary: "Fragile 2018 peace agreement; intercommunal violence and armed faction clashes continue in multiple states.",
    dataSources: ["ACLED", "UN OCHA", "UCDP"],
  },
] as const;

/**
 * Canonical list of data sources used in the Flashpoints system.
 * Displayed in the attribution footer of the map widget.
 */
export const FLASHPOINT_DATA_SOURCES: readonly string[] = [
  "ACLED",
  "CFR Global Conflict Tracker",
  "UCDP",
  "UN OCHA",
  "DoD",
  "Live News Feeds",
] as const;

/**
 * O(1) lookup: ISO code → conflicts involving that country as a primary code
 * or as a listed party.
 */
const _byCode = new Map<string, StaticConflict[]>();
for (const c of STATIC_CONFLICTS) {
  const codes = new Set([c.code, ...c.parties]);
  for (const code of codes) {
    const existing = _byCode.get(code);
    if (existing) existing.push(c);
    else _byCode.set(code, [c]);
  }
}

/** Return all static conflicts involving `isoCode` as primary or party. */
export function getConflictsByCode(isoCode: string): StaticConflict[] {
  return _byCode.get(isoCode.toUpperCase()) ?? [];
}
