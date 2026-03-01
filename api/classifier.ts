/**
 * Event classification — severity and category detection.
 *
 * No external dependencies.  Precompiled regexes replace per-keyword
 * .includes() calls: 8 .test() calls instead of up to 114 per article.
 *
 * Also exports `cleanSnippet`, which strips common RSS/web boilerplate
 * (nav items, cookie notices, subscribe prompts, social-share CTAs) from
 * content snippets before classification and country scoring.
 * Inspired by the boilerplate-cleaning approach used in GlobalThreatMap's
 * event-classifier.ts (github.com/unicodeveloper/globalthreatmap).
 */

export type EventSeverity = "high" | "medium" | "low";
export type EventCategory = "violent" | "minor" | "economic" | "extremism" | "escalation";

/** Outlet name patterns that contain country keywords and must be stripped from
 *  both titles and content snippets before country detection to prevent false
 *  attribution.  "France 24" → contains "france"; all other current sources are safe. */
export const OUTLET_NAME_RE = /\bfrance\s*24\b/gi;

// ── Classification keyword lists ─────────────────────────────────────────────
// Ordered most-specific / most-severe first so the earliest match wins.

// ── Violent ──────────────────────────────────────────────────────────────────
const HIGH_VIOLENT = [
  "bombing", "explosion", "suicide attack", "terrorist attack",
  "killed", "death toll", "casualties", "massacre", "murder", "homicide",
  "airstrike", "air strike", "missile strike", "drone strike",
  "arson", "fire bomb",
];
const MEDIUM_VIOLENT = [
  "shooting", "stabbing", "assault", "riot",
  "violent protest", "clashes", "street fighting", "armed confrontation",
  "hostage", "abduction", "kidnapping",
  "sabotage", "vandalism",
];

// ── Civil unrest / minor / humanitarian ──────────────────────────────────────
const LOW_MINOR = [
  "peaceful protest", "demonstration", "march", "worker strike",
  "civil unrest", "blockade", "curfew", "evacuation",
  "power outage", "flooding", "earthquake", "storm",
  "social unrest", "tension", "dispute",
  // Humanitarian / disaster terms — surfaces ReliefWeb and UN News articles
  "refugee", "refugees", "displaced", "displacement",
  "humanitarian", "famine", "drought",
  "disease outbreak", "epidemic", "aid convoy",
];

// ── Economic ─────────────────────────────────────────────────────────────────
const HIGH_ECONOMIC = [
  "stock market crash", "market collapse", "market plunge",
  "hyperinflation", "currency collapse", "devaluation", "economic meltdown",
  "debt default", "sovereign default", "government default",
  "banking crisis", "bank run", "financial crisis",
  "severe sanctions", "trade embargo", "trade war",
  "mass unemployment", "factory closure", "supply chain collapse",
  "food shortage", "energy crisis",
];

// ── Extremism ─────────────────────────────────────────────────────────────────
/** Violent attacks with a clearly identified extremist/ideological motive */
const HIGH_EXTREMISM = [
  "neo-nazi attack", "neo nazi attack", "neonazi attack",
  "white supremacist attack", "far-right attack", "far right attack",
  "far-left attack", "far left attack", "antifa attack",
  "antisemitic attack", "antisemitic shooting", "antisemitic stabbing",
  "extremist bombing", "hate crime killing", "hate crime murder",
];
/** Extremist ideology, movements, rallies, and hate-crime activity */
const MEDIUM_EXTREMISM = [
  "neo-nazi", "neo nazi", "neonazi",
  "white supremacist", "white supremacy", "white nationalist",
  "antisemitism", "antisemitic", "antisemite",
  "far-right extremist", "far right extremist",
  "far-left extremist", "far left extremist",
  "antifa", "fascist rally", "nazi rally", "nazi march",
  "hate group", "hate march", "extremist rally",
  "kkk", "ku klux klan",
  "political extremism", "radicalization", "radicalisation",
  "islamophobic attack", "islamophobia",
  "alt-right", "alt right", "proud boys", "oath keepers",
];

// ── Escalation / pre-conflict — EARLY WARNING ─────────────────────────────────
// These signals precede active violence: military positioning, diplomatic breakdown,
// political seizures and WMD threats.  Detecting them earlier than violence keywords
// is the key to the "as early as possible" goal.
/** High-severity pre-conflict signals — imminent or acute crisis */
const HIGH_ESCALATION = [
  // Political seizures
  "coup attempt", "coup d'état", "attempted coup", "military takeover",
  "martial law", "state of emergency declared",
  // WMD / strategic weapons
  "nuclear threat", "nuclear alert", "nuclear readiness",
  "ballistic missile launched", "intercontinental missile", "hypersonic missile",
  "chemical attack", "chemical weapons used", "biological attack",
  // Airspace / major strategic moves
  "airspace closed", "airspace closure",
  "full military mobilization", "general mobilization",
];
/** Medium-severity pre-conflict signals — escalating but not yet at war */
const MEDIUM_ESCALATION = [
  // Military movements
  "troops deployed", "troops massing", "military buildup",
  "military mobilization", "mobilisation near",
  "military exercises", "war games", "live-fire drill",
  "warships deployed", "naval standoff", "aircraft carrier deployed",
  "tanks at border", "forces at border",
  // Diplomatic breakdown
  "expels ambassador", "ambassador expelled", "recalls ambassador",
  "diplomatic crisis", "severed diplomatic ties", "diplomatic breakdown",
  "new sanctions", "sanctions package", "sanctions announced",
  "border closed", "border closure", "border sealed",
  // Domestic crackdown
  "opposition arrested", "opposition leader arrested",
  "mass arrests", "protesters arrested", "crackdown on",
  "state of emergency", "emergency powers",
  "protest crackdown", "demonstrators detained",
  // Threat language
  "ultimatum", "war warning", "military threat",
  "brink of war", "on the brink", "armed standoff",
  "military standoff", "nuclear standoff",
  // Pre-coup signals
  "soldiers surrounding", "parliament surrounded",
  "president detained", "prime minister detained",
];

/**
 * Build a single precompiled RegExp from a keyword list.
 * Joining all keywords with `|` means V8's regex engine scans the lowercased
 * text in one pass rather than calling String.prototype.includes() once per
 * keyword.  Metacharacters in keywords are escaped so they match literally.
 *
 * Using case-sensitive matching here because callers always lowercase the text
 * before calling classifyEvent — this is faster than the `i` flag since V8
 * does not need to perform case folding on every character.
 */
function buildClassifyRe(keywords: string[]): RegExp {
  return new RegExp(
    keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  );
}

// Precompiled once at module load — reused for every article across all requests.
// Replaces up to 114 sequential .includes() calls per article with 8 .test() calls.
const RE_HIGH_ECONOMIC     = buildClassifyRe(HIGH_ECONOMIC);
const RE_HIGH_EXTREMISM    = buildClassifyRe(HIGH_EXTREMISM);
const RE_MEDIUM_EXTREMISM  = buildClassifyRe(MEDIUM_EXTREMISM);
const RE_HIGH_ESCALATION   = buildClassifyRe(HIGH_ESCALATION);
const RE_MEDIUM_ESCALATION = buildClassifyRe(MEDIUM_ESCALATION);
const RE_HIGH_VIOLENT      = buildClassifyRe(HIGH_VIOLENT);
const RE_MEDIUM_VIOLENT    = buildClassifyRe(MEDIUM_VIOLENT);
const RE_LOW_MINOR         = buildClassifyRe(LOW_MINOR);

export function classifyEvent(text: string): { severity: EventSeverity; category: EventCategory } | null {
  const lower = text.toLowerCase();
  if (RE_HIGH_ECONOMIC.test(lower))     return { severity: "high",   category: "economic"    };
  if (RE_HIGH_EXTREMISM.test(lower))    return { severity: "high",   category: "extremism"   };
  if (RE_MEDIUM_EXTREMISM.test(lower))  return { severity: "medium", category: "extremism"   };
  // Pre-conflict escalation signals — checked BEFORE generic violence so that
  // "killed during coup attempt" maps to escalation, not just violent.
  if (RE_HIGH_ESCALATION.test(lower))   return { severity: "high",   category: "escalation"  };
  if (RE_MEDIUM_ESCALATION.test(lower)) return { severity: "medium", category: "escalation"  };
  if (RE_HIGH_VIOLENT.test(lower))      return { severity: "high",   category: "violent"     };
  if (RE_MEDIUM_VIOLENT.test(lower))    return { severity: "medium", category: "violent"     };
  if (RE_LOW_MINOR.test(lower))         return { severity: "low",    category: "minor"       };
  return null;
}

/**
 * Strip common RSS/web boilerplate from a content snippet before it is used
 * for classification or country detection.
 *
 * Many RSS feeds embed navigation links, cookie-consent notices, subscribe
 * prompts, and social-share CTAs inside their <description> or
 * <content:encoded> elements.  Leaving this noise in place can cause
 * false-positive keyword matches ("breaking news alert" → violent) and
 * dilute the country-scoring signal from the scoring engine.
 *
 * Only applied to the snippet/body text; article titles are preserved as-is.
 */
export function cleanSnippet(text: string): string {
  return text
    // Cookie / consent / privacy notices
    .replace(/\b(?:we use cookies?|cookie policy|cookie settings?|privacy policy|terms of (?:service|use)|gdpr|ccpa)\b[^.]*\.?/gi, "")
    // Subscribe / sign-in prompts
    .replace(/\b(?:subscribe(?:\s+now)?|sign (?:in|up|out)|log (?:in|out)|newsletter|already a subscriber|get (?:the|our) newsletter)\b[^.]*\.?/gi, "")
    // Navigation artefacts
    .replace(/\b(?:skip to (?:main |primary )?content|toggle (?:navigation|menu)|hamburger menu)\b[^.]*\.?/gi, "")
    // Social-share / follow / app-download prompts
    .replace(/\b(?:follow us on|share (?:this|on)|click (?:here|to share)|download (?:our )?app|get the app)\b[^.]*\.?/gi, "")
    // "Related / recommended / trending" section headings
    .replace(/\b(?:related (?:articles?|stories?|posts?)|recommended (?:for you|articles?)|trending (?:now|stories?)|most (?:read|popular|viewed))\b[^.]*\.?/gi, "")
    // Advertisement labels
    .replace(/\b(?:advertisement|sponsored (?:content|by)|advertising)\b[^.]*\.?/gi, "")
    // Collapse repeated whitespace
    .replace(/\s{2,}/g, " ")
    .trim();
}
