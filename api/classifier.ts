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

/** Outlet name patterns that contain country keywords and must be stripped from
 *  both titles and content snippets before country detection to prevent false
 *  attribution.  "France 24" → contains "france"; all other current sources are safe. */
export const OUTLET_NAME_RE = /\bfrance\s*24\b/gi;

// ── Classification keyword lists ─────────────────────────────────────────────
// Ordered most-specific / most-severe first so the earliest match wins.
// New categories (terrorism, cyber, health, etc.) are checked before the
// legacy broad categories so that specific patterns are not swallowed by
// generic violence or minor-event keywords.

// ── Terrorism ────────────────────────────────────────────────────────────────
const HIGH_TERRORISM = [
  "terrorist attack", "suicide bomb", "suicide bomber", "suicide bombing",
  "car bomb", "car bombing", "vehicle ramming",
  "isis attack", "isil attack", "al-qaeda attack", "al qaeda attack",
  "jihadist attack", "jihadi attack", "islamist attack",
  "coordinated attack", "mass casualty attack",
  "terror plot", "terror attack",
];
const MEDIUM_TERRORISM = [
  "terrorism", "terrorist", "jihadist", "jihadists", "islamist militant",
  "isis", "isil", "al-qaeda", "al qaeda", "boko haram", "hamas attack",
  "hezbollah attack", "ied detonated", "ied explosion",
  "terror suspect", "terror cell", "terror threat", "bomb threat",
];

// ── Cyber ─────────────────────────────────────────────────────────────────────
const HIGH_CYBER = [
  "cyberattack", "cyber attack", "ransomware attack", "ransomware",
  "state-sponsored hack", "state sponsored hack",
  "critical infrastructure hack", "power grid hack", "power grid attack",
  "government systems hacked", "election interference hack",
  "data breach", "massive data breach",
];
const MEDIUM_CYBER = [
  "cyber espionage", "cyber warfare", "ddos attack", "ddos",
  "malware campaign", "phishing campaign", "hacking campaign",
  "network intrusion", "systems compromised", "systems breached",
  "zero-day exploit", "zero day exploit",
  "national security breach", "intelligence hack",
];

// ── Health / Pandemic ─────────────────────────────────────────────────────────
const HIGH_HEALTH = [
  "pandemic", "global pandemic", "health emergency", "public health emergency",
  "disease outbreak", "outbreak declared", "epidemic outbreak",
  "mass casualty disease", "virus spreading", "pathogen outbreak",
  "covid", "ebola", "mpox", "monkeypox", "plague outbreak",
  "who declares emergency", "health crisis",
];
const MEDIUM_HEALTH = [
  "epidemic", "disease spread", "outbreak", "quarantine",
  "vaccination campaign", "vaccine shortage", "drug-resistant",
  "cholera", "measles outbreak", "dengue outbreak", "malaria surge",
  "mass vaccination", "contact tracing", "health alert",
];

// ── Environmental / Climate ───────────────────────────────────────────────────
const HIGH_ENVIRONMENTAL = [
  "catastrophic wildfire", "massive wildfire", "wildfire emergency",
  "climate emergency", "climate catastrophe",
  "catastrophic flooding", "extreme flooding", "flash flood kills",
  "category 5", "major hurricane", "super typhoon",
  "ecological disaster", "environmental catastrophe",
];
const MEDIUM_ENVIRONMENTAL = [
  "wildfire", "forest fire", "bushfire",
  "flooding", "floods", "flood warning",
  "drought emergency", "water crisis",
  "hurricane", "typhoon", "cyclone",
  "heatwave", "extreme heat", "record temperatures",
  "pollution crisis", "toxic spill",
  "deforestation", "environmental damage",
];

// ── Disaster (natural / humanitarian) ────────────────────────────────────────
const HIGH_DISASTER = [
  "major earthquake", "devastating earthquake", "earthquake kills",
  "tsunami warning", "tsunami hits",
  "volcanic eruption", "volcano erupts",
  "humanitarian catastrophe", "mass displacement",
  "famine declared", "starvation crisis",
];
const MEDIUM_DISASTER = [
  "earthquake", "tsunami", "volcanic",
  "humanitarian crisis", "humanitarian emergency",
  "refugee crisis", "displaced persons", "mass evacuation",
  "famine", "drought", "food insecurity",
  "aid workers", "relief operations",
];

// ── Infrastructure ────────────────────────────────────────────────────────────
const HIGH_INFRASTRUCTURE = [
  "infrastructure attack", "pipeline attack", "power grid down",
  "communications blackout", "internet shutdown",
  "bridge collapse", "dam collapse",
  "water supply contaminated", "water system attack",
  "port blocked", "supply route cut",
];
const MEDIUM_INFRASTRUCTURE = [
  "power outage", "blackout", "grid failure",
  "pipeline disruption", "pipeline explosion",
  "communications disrupted", "satellite disruption",
  "critical infrastructure",
];

// ── Crime / Organised Crime ───────────────────────────────────────────────────
const HIGH_CRIME = [
  "cartel massacre", "gang massacre", "cartel war",
  "drug cartel kills", "organised crime killing", "mob hit",
  "human trafficking network", "human smuggling network",
  "arms trafficking bust", "drug trafficking bust",
];
const MEDIUM_CRIME = [
  "cartel", "drug trafficking", "drug cartel", "narco",
  "organised crime", "organized crime", "criminal gang",
  "gang war", "gang violence", "mafia", "mob violence",
  "human trafficking", "arms smuggling", "money laundering",
  "kidnap for ransom",
];

// ── Piracy / Maritime Security ────────────────────────────────────────────────
const HIGH_PIRACY = [
  "ship hijacked", "vessel hijacked", "vessel seized",
  "pirates attack", "piracy attack", "maritime attack",
  "sailors held hostage", "crew kidnapped",
];
const MEDIUM_PIRACY = [
  "piracy", "pirates", "pirate",
  "maritime security incident", "shipping lane attack",
  "houthi ship attack", "houthi vessel", "red sea attack",
  "tanker seized", "cargo ship attacked",
];

// ── Diplomatic ────────────────────────────────────────────────────────────────
const HIGH_DIPLOMATIC = [
  "peace talks collapse", "ceasefire collapse", "peace deal collapsed",
  "diplomatic rupture", "diplomatic relations severed",
  "ambassador expelled", "expels ambassador", "ambassador recalled",
];
const MEDIUM_DIPLOMATIC = [
  "peace talks", "peace deal", "ceasefire agreement",
  "diplomatic talks", "summit meeting", "state visit",
  "trade negotiations", "bilateral talks",
  "diplomatic incident", "persona non grata",
  "foreign minister meets", "secretary of state meets",
];

// ── Military ──────────────────────────────────────────────────────────────────
const HIGH_MILITARY = [
  "military offensive", "military invasion", "ground offensive",
  "military operation launched", "combat operation",
  "troops advance", "forces seize", "military assault",
];
const MEDIUM_MILITARY = [
  "military operation", "special operation", "military exercise",
  "defense contract", "military aid", "arms delivery", "weapons delivery",
  "troop withdrawal", "military withdrawal", "peacekeeping mission",
  "military deployment", "naval patrol",
  "defense spending", "military budget",
];

// ── Commodities / Resource Supply ────────────────────────────────────────────
const HIGH_COMMODITIES = [
  "oil price surge", "oil price crash", "oil embargo",
  "gas supply cut", "energy supply crisis",
  "wheat shortage", "grain embargo", "food prices surge",
  "commodity shortage", "crop failure", "harvest failure",
  "fuel shortage", "petrol shortage",
];
const MEDIUM_COMMODITIES = [
  "oil prices", "gas prices", "energy prices",
  "wheat prices", "grain prices", "food prices",
  "commodity markets", "supply disruption",
  "opec", "oil production cut", "lng supply",
];

// ── Protest / Civil Unrest ───────────────────────────────────────────────────
const MEDIUM_PROTEST = [
  "protests", "protesters", "protest", "protesters take to the streets",
  "mass protest", "nationwide protest", "general strike",
  "worker strike", "workers strike", "trade union strike",
  "demonstration", "demonstrators", "march",
  "civil disobedience", "sit-in",
];

// ── Violent ──────────────────────────────────────────────────────────────────
const HIGH_VIOLENT = [
  "bombing", "explosion",
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
  "civil unrest", "blockade", "curfew", "evacuation",
  "social unrest", "tension", "dispute",
  // Humanitarian / disaster terms — surfaces ReliefWeb and UN News articles
  "refugee", "refugees", "displaced", "displacement",
  "humanitarian", "aid convoy",
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
  "warships deployed", "naval standoff", "aircraft carrier deployed",
  "tanks at border", "forces at border",
  // Diplomatic breakdown
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
const RE_HIGH_TERRORISM      = buildClassifyRe(HIGH_TERRORISM);
const RE_MEDIUM_TERRORISM    = buildClassifyRe(MEDIUM_TERRORISM);
const RE_HIGH_CYBER          = buildClassifyRe(HIGH_CYBER);
const RE_MEDIUM_CYBER        = buildClassifyRe(MEDIUM_CYBER);
const RE_HIGH_HEALTH         = buildClassifyRe(HIGH_HEALTH);
const RE_MEDIUM_HEALTH       = buildClassifyRe(MEDIUM_HEALTH);
const RE_HIGH_ENVIRONMENTAL  = buildClassifyRe(HIGH_ENVIRONMENTAL);
const RE_MEDIUM_ENVIRONMENTAL= buildClassifyRe(MEDIUM_ENVIRONMENTAL);
const RE_HIGH_DISASTER       = buildClassifyRe(HIGH_DISASTER);
const RE_MEDIUM_DISASTER     = buildClassifyRe(MEDIUM_DISASTER);
const RE_HIGH_INFRASTRUCTURE = buildClassifyRe(HIGH_INFRASTRUCTURE);
const RE_MEDIUM_INFRASTRUCTURE=buildClassifyRe(MEDIUM_INFRASTRUCTURE);
const RE_HIGH_CRIME          = buildClassifyRe(HIGH_CRIME);
const RE_MEDIUM_CRIME        = buildClassifyRe(MEDIUM_CRIME);
const RE_HIGH_PIRACY         = buildClassifyRe(HIGH_PIRACY);
const RE_MEDIUM_PIRACY       = buildClassifyRe(MEDIUM_PIRACY);
const RE_HIGH_DIPLOMATIC     = buildClassifyRe(HIGH_DIPLOMATIC);
const RE_MEDIUM_DIPLOMATIC   = buildClassifyRe(MEDIUM_DIPLOMATIC);
const RE_HIGH_MILITARY       = buildClassifyRe(HIGH_MILITARY);
const RE_MEDIUM_MILITARY     = buildClassifyRe(MEDIUM_MILITARY);
const RE_HIGH_COMMODITIES    = buildClassifyRe(HIGH_COMMODITIES);
const RE_MEDIUM_COMMODITIES  = buildClassifyRe(MEDIUM_COMMODITIES);
const RE_MEDIUM_PROTEST      = buildClassifyRe(MEDIUM_PROTEST);
const RE_HIGH_ECONOMIC       = buildClassifyRe(HIGH_ECONOMIC);
const RE_HIGH_EXTREMISM      = buildClassifyRe(HIGH_EXTREMISM);
const RE_MEDIUM_EXTREMISM    = buildClassifyRe(MEDIUM_EXTREMISM);
const RE_HIGH_ESCALATION     = buildClassifyRe(HIGH_ESCALATION);
const RE_MEDIUM_ESCALATION   = buildClassifyRe(MEDIUM_ESCALATION);
const RE_HIGH_VIOLENT        = buildClassifyRe(HIGH_VIOLENT);
const RE_MEDIUM_VIOLENT      = buildClassifyRe(MEDIUM_VIOLENT);
const RE_LOW_MINOR           = buildClassifyRe(LOW_MINOR);

export function classifyEvent(text: string): { severity: EventSeverity; category: EventCategory } | null {
  const lower = text.toLowerCase();
  // ── Specific categories first (highest precision) ─────────────────────────
  // Terrorism — checked before generic violence so "terrorist attack kills 5"
  // routes to terrorism rather than violent.
  if (RE_HIGH_TERRORISM.test(lower))       return { severity: "high",   category: "terrorism"     };
  if (RE_MEDIUM_TERRORISM.test(lower))     return { severity: "medium", category: "terrorism"     };
  // Cyber — highly specific technical vocabulary
  if (RE_HIGH_CYBER.test(lower))           return { severity: "high",   category: "cyber"         };
  if (RE_MEDIUM_CYBER.test(lower))         return { severity: "medium", category: "cyber"         };
  // Piracy — specific maritime terms
  if (RE_HIGH_PIRACY.test(lower))          return { severity: "high",   category: "piracy"        };
  if (RE_MEDIUM_PIRACY.test(lower))        return { severity: "medium", category: "piracy"        };
  // Crime — organised crime / cartels (before generic violent)
  if (RE_HIGH_CRIME.test(lower))           return { severity: "high",   category: "crime"         };
  if (RE_MEDIUM_CRIME.test(lower))         return { severity: "medium", category: "crime"         };
  // Health — pandemic / outbreak signals (before minor to elevate severity)
  if (RE_HIGH_HEALTH.test(lower))          return { severity: "high",   category: "health"        };
  if (RE_MEDIUM_HEALTH.test(lower))        return { severity: "medium", category: "health"        };
  // Military operations (before escalation to distinguish active ops from threats)
  if (RE_HIGH_MILITARY.test(lower))        return { severity: "high",   category: "military"      };
  if (RE_MEDIUM_MILITARY.test(lower))      return { severity: "medium", category: "military"      };
  // Diplomatic — peace / negotiations (before escalation)
  if (RE_HIGH_DIPLOMATIC.test(lower))      return { severity: "high",   category: "diplomatic"    };
  if (RE_MEDIUM_DIPLOMATIC.test(lower))    return { severity: "medium", category: "diplomatic"    };
  // Commodities — resource / supply shocks (before generic economic)
  if (RE_HIGH_COMMODITIES.test(lower))     return { severity: "high",   category: "commodities"   };
  if (RE_MEDIUM_COMMODITIES.test(lower))   return { severity: "medium", category: "commodities"   };
  // Infrastructure — before minor to elevate severity
  if (RE_HIGH_INFRASTRUCTURE.test(lower))  return { severity: "high",   category: "infrastructure"};
  if (RE_MEDIUM_INFRASTRUCTURE.test(lower))return { severity: "medium", category: "infrastructure"};
  // Environmental — before minor / disaster
  if (RE_HIGH_ENVIRONMENTAL.test(lower))   return { severity: "high",   category: "environmental" };
  if (RE_MEDIUM_ENVIRONMENTAL.test(lower)) return { severity: "medium", category: "environmental" };
  // Natural / humanitarian disasters
  if (RE_HIGH_DISASTER.test(lower))        return { severity: "high",   category: "disaster"      };
  if (RE_MEDIUM_DISASTER.test(lower))      return { severity: "medium", category: "disaster"      };
  // ── Legacy broad categories ───────────────────────────────────────────────
  // Economic crises — distinct from violence; checked before violence keywords
  if (RE_HIGH_ECONOMIC.test(lower))        return { severity: "high",   category: "economic"      };
  // Extremism (ideologically motivated hate / movements)
  if (RE_HIGH_EXTREMISM.test(lower))       return { severity: "high",   category: "extremism"     };
  if (RE_MEDIUM_EXTREMISM.test(lower))     return { severity: "medium", category: "extremism"     };
  // Pre-conflict escalation signals — checked BEFORE generic violence so that
  // "killed during coup attempt" maps to escalation, not just violent.
  if (RE_HIGH_ESCALATION.test(lower))      return { severity: "high",   category: "escalation"    };
  if (RE_MEDIUM_ESCALATION.test(lower))    return { severity: "medium", category: "escalation"    };
  // Active violent events
  if (RE_HIGH_VIOLENT.test(lower))         return { severity: "high",   category: "violent"       };
  if (RE_MEDIUM_VIOLENT.test(lower))       return { severity: "medium", category: "violent"       };
  // Civil demonstrations / protests
  if (RE_MEDIUM_PROTEST.test(lower))       return { severity: "low",    category: "protest"       };
  // Catch-all low-level / context events
  if (RE_LOW_MINOR.test(lower))            return { severity: "low",    category: "minor"         };
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
