export interface CountryInfo {
  code: string;
  name: string;
  lat: number;
  lng: number;
  keywords: string[];
}

/** Major countries with approximate centre coordinates and detection keywords */
export const COUNTRIES: CountryInfo[] = [
  { code: "US", name: "United States", lat: 37.09, lng: -95.71, keywords: ["united states", "america", "washington", "new york", "los angeles", "chicago", "texas", "california", "pentagon", "white house", "congress", "u.s.", "us "] },
  { code: "GB", name: "United Kingdom", lat: 55.38, lng: -3.44, keywords: ["united kingdom", "britain", "england", "london", "scotland", "wales", "birmingham", "manchester", "u.k.", "uk "] },
  { code: "FR", name: "France", lat: 46.23, lng: 2.21, keywords: ["france", "french", "paris", "lyon", "marseille", "élysée"] },
  { code: "DE", name: "Germany", lat: 51.17, lng: 10.45, keywords: ["germany", "german", "berlin", "munich", "hamburg", "frankfurt", "bundestag"] },
  { code: "RU", name: "Russia", lat: 61.52, lng: 105.32, keywords: ["russia", "russian", "moscow", "kremlin", "putin", "siberia", "st. petersburg", "saint petersburg"] },
  { code: "CN", name: "China", lat: 35.86, lng: 104.19, keywords: ["china", "chinese", "beijing", "shanghai", "xi jinping", "hong kong", "taiwan strait", "xinjiang", "tibet"] },
  { code: "JP", name: "Japan", lat: 36.20, lng: 138.25, keywords: ["japan", "japanese", "tokyo", "osaka", "kyoto", "hiroshima", "nagasaki"] },
  { code: "IN", name: "India", lat: 20.59, lng: 78.96, keywords: ["india", "indian", "new delhi", "delhi", "mumbai", "bangalore", "kashmir", "modi"] },
  { code: "PK", name: "Pakistan", lat: 30.38, lng: 69.35, keywords: ["pakistan", "pakistani", "islamabad", "karachi", "lahore", "peshawar"] },
  { code: "AF", name: "Afghanistan", lat: 33.94, lng: 67.71, keywords: ["afghanistan", "afghan", "kabul", "kandahar", "taliban"] },
  { code: "IR", name: "Iran", lat: 32.43, lng: 53.69, keywords: ["iran", "iranian", "tehran", "isfahan", "khamenei", "rouhani", "irgc", "persian"] },
  { code: "IQ", name: "Iraq", lat: 33.22, lng: 43.68, keywords: ["iraq", "iraqi", "baghdad", "mosul", "basra", "erbil", "kirkuk"] },
  { code: "SY", name: "Syria", lat: 34.80, lng: 38.99, keywords: ["syria", "syrian", "damascus", "aleppo", "homs", "idlib", "isis", "isil"] },
  { code: "IL", name: "Israel", lat: 31.05, lng: 34.85, keywords: ["israel", "israeli", "jerusalem", "tel aviv", "netanyahu", "idf", "west bank", "gaza"] },
  { code: "PS", name: "Palestine", lat: 31.95, lng: 35.23, keywords: ["palestine", "palestinian", "gaza", "ramallah", "hamas", "west bank"] },
  { code: "SA", name: "Saudi Arabia", lat: 23.89, lng: 45.08, keywords: ["saudi arabia", "saudi", "riyadh", "jeddah", "mecca", "medina", "mbs"] },
  { code: "AE", name: "UAE", lat: 23.42, lng: 53.85, keywords: ["uae", "united arab emirates", "dubai", "abu dhabi"] },
  { code: "JO", name: "Jordan", lat: 30.59, lng: 36.24, keywords: ["jordan", "jordanian", "amman"] },
  { code: "QA", name: "Qatar", lat: 25.35, lng: 51.18, keywords: ["qatar", "qatari", "doha"] },
  { code: "KW", name: "Kuwait", lat: 29.37, lng: 47.98, keywords: ["kuwait", "kuwaiti", "kuwait city"] },
  { code: "BH", name: "Bahrain", lat: 26.07, lng: 50.56, keywords: ["bahrain", "bahraini", "manama"] },
  { code: "OM", name: "Oman", lat: 21.47, lng: 55.97, keywords: ["oman", "omani", "muscat"] },
  { code: "YE", name: "Yemen", lat: 15.55, lng: 48.52, keywords: ["yemen", "yemeni", "sanaa", "aden", "houthi"] },
  { code: "LB", name: "Lebanon", lat: 33.85, lng: 35.86, keywords: ["lebanon", "lebanese", "beirut", "hezbollah"] },
  { code: "TR", name: "Turkey", lat: 38.96, lng: 35.24, keywords: ["turkey", "turkish", "ankara", "istanbul", "erdogan"] },
  { code: "UA", name: "Ukraine", lat: 48.38, lng: 31.17, keywords: ["ukraine", "ukrainian", "kyiv", "kharkiv", "odessa", "mariupol", "zelensky", "donbas", "zaporizhzhia"] },
  { code: "BY", name: "Belarus", lat: 53.71, lng: 27.95, keywords: ["belarus", "belarusian", "minsk", "lukashenko"] },
  { code: "PL", name: "Poland", lat: 51.92, lng: 19.15, keywords: ["poland", "polish", "warsaw", "krakow"] },
  { code: "BR", name: "Brazil", lat: -14.24, lng: -51.93, keywords: ["brazil", "brazilian", "brasilia", "são paulo", "sao paulo", "rio de janeiro", "amazon", "lula"] },
  { code: "MX", name: "Mexico", lat: 23.63, lng: -102.55, keywords: ["mexico", "mexican", "mexico city", "guadalajara", "monterrey", "cartel", "pemex"] },
  { code: "CO", name: "Colombia", lat: 4.57, lng: -74.30, keywords: ["colombia", "colombian", "bogota", "medellin", "farc"] },
  { code: "VE", name: "Venezuela", lat: 6.42, lng: -66.59, keywords: ["venezuela", "venezuelan", "caracas", "maduro"] },
  { code: "AR", name: "Argentina", lat: -38.42, lng: -63.62, keywords: ["argentina", "argentine", "buenos aires", "milei"] },
  { code: "CL", name: "Chile", lat: -35.68, lng: -71.54, keywords: ["chile", "chilean", "santiago"] },
  { code: "BO", name: "Bolivia", lat: -16.29, lng: -63.59, keywords: ["bolivia", "bolivian", "la paz", "santa cruz", "cochabamba"] },
  { code: "PE", name: "Peru", lat: -9.19, lng: -75.02, keywords: ["peru", "peruvian", "lima", "arequipa"] },
  { code: "EC", name: "Ecuador", lat: -1.83, lng: -78.18, keywords: ["ecuador", "ecuadorian", "quito", "guayaquil"] },
  { code: "PY", name: "Paraguay", lat: -23.44, lng: -58.44, keywords: ["paraguay", "paraguayan", "asuncion"] },
  { code: "UY", name: "Uruguay", lat: -32.52, lng: -55.77, keywords: ["uruguay", "uruguayan", "montevideo"] },
  { code: "NG", name: "Nigeria", lat: 9.08, lng: 8.68, keywords: ["nigeria", "nigerian", "abuja", "lagos", "kano", "boko haram"] },
  { code: "ZA", name: "South Africa", lat: -30.56, lng: 22.94, keywords: ["south africa", "south african", "johannesburg", "cape town", "pretoria", "anc"] },
  { code: "ET", name: "Ethiopia", lat: 9.15, lng: 40.49, keywords: ["ethiopia", "ethiopian", "addis ababa", "tigray"] },
  { code: "SD", name: "Sudan", lat: 12.86, lng: 30.22, keywords: ["sudan", "sudanese", "khartoum", "darfur", "rsf"] },
  { code: "LY", name: "Libya", lat: 26.34, lng: 17.23, keywords: ["libya", "libyan", "tripoli", "benghazi"] },
  { code: "ML", name: "Mali", lat: 17.57, lng: -3.99, keywords: ["mali", "malian", "bamako"] },
  { code: "SO", name: "Somalia", lat: 5.15, lng: 46.20, keywords: ["somalia", "somali", "mogadishu", "al-shabaab", "al shabaab"] },
  { code: "SS", name: "South Sudan", lat: 6.88, lng: 31.31, keywords: ["south sudan", "south sudanese", "juba"] },
  { code: "CD", name: "DR Congo", lat: -4.04, lng: 21.76, keywords: ["congo", "congolese", "kinshasa", "drc", "m23"] },
  { code: "KP", name: "North Korea", lat: 40.34, lng: 127.51, keywords: ["north korea", "north korean", "pyongyang", "kim jong-un", "kim jong un", "dprk"] },
  { code: "KR", name: "South Korea", lat: 35.91, lng: 127.77, keywords: ["south korea", "south korean", "seoul", "busan"] },
  { code: "TW", name: "Taiwan", lat: 23.70, lng: 120.96, keywords: ["taiwan", "taiwanese", "taipei"] },
  { code: "MM", name: "Myanmar", lat: 21.91, lng: 95.96, keywords: ["myanmar", "burmese", "naypyidaw", "yangon", "rangoon", "junta"] },
  { code: "TH", name: "Thailand", lat: 15.87, lng: 100.99, keywords: ["thailand", "thai", "bangkok"] },
  { code: "PH", name: "Philippines", lat: 12.88, lng: 121.77, keywords: ["philippines", "philippine", "manila", "mindanao", "duterte", "marcos"] },
  { code: "ID", name: "Indonesia", lat: -0.79, lng: 113.92, keywords: ["indonesia", "indonesian", "jakarta"] },
  { code: "VN", name: "Vietnam", lat: 14.06, lng: 108.28, keywords: ["vietnam", "vietnamese", "hanoi", "ho chi minh", "saigon"] },
  { code: "MY", name: "Malaysia", lat: 4.21, lng: 101.97, keywords: ["malaysia", "malaysian", "kuala lumpur"] },
  { code: "KH", name: "Cambodia", lat: 12.57, lng: 104.99, keywords: ["cambodia", "cambodian", "phnom penh", "khmer"] },
  { code: "EG", name: "Egypt", lat: 26.82, lng: 30.80, keywords: ["egypt", "egyptian", "cairo", "sinai", "sisi"] },
  { code: "MA", name: "Morocco", lat: 31.79, lng: -7.09, keywords: ["morocco", "moroccan", "rabat", "casablanca"] },
  { code: "DZ", name: "Algeria", lat: 28.03, lng: 1.66, keywords: ["algeria", "algerian", "algiers"] },
  { code: "TN", name: "Tunisia", lat: 33.89, lng: 9.54, keywords: ["tunisia", "tunisian", "tunis"] },
  { code: "GH", name: "Ghana", lat: 7.95, lng: -1.02, keywords: ["ghana", "ghanaian", "accra"] },
  { code: "KE", name: "Kenya", lat: -0.02, lng: 37.91, keywords: ["kenya", "kenyan", "nairobi"] },
  { code: "TZ", name: "Tanzania", lat: -6.37, lng: 34.89, keywords: ["tanzania", "tanzanian", "dar es salaam", "dodoma"] },
  { code: "UG", name: "Uganda", lat: 1.37, lng: 32.29, keywords: ["uganda", "ugandan", "kampala"] },
  { code: "RW", name: "Rwanda", lat: -1.94, lng: 29.87, keywords: ["rwanda", "rwandan", "kigali"] },
  { code: "MZ", name: "Mozambique", lat: -18.67, lng: 35.53, keywords: ["mozambique", "mozambican", "maputo", "cabo delgado"] },
  { code: "ZW", name: "Zimbabwe", lat: -19.02, lng: 29.15, keywords: ["zimbabwe", "zimbabwean", "harare"] },
  { code: "AO", name: "Angola", lat: -11.20, lng: 17.87, keywords: ["angola", "angolan", "luanda"] },
  { code: "CM", name: "Cameroon", lat: 7.37, lng: 12.35, keywords: ["cameroon", "cameroonian", "yaounde", "douala"] },
  { code: "CI", name: "Ivory Coast", lat: 7.54, lng: -5.55, keywords: ["ivory coast", "ivorian", "abidjan", "cote d'ivoire", "côte d'ivoire"] },
  { code: "SN", name: "Senegal", lat: 14.50, lng: -14.45, keywords: ["senegal", "senegalese", "dakar"] },
  { code: "BF", name: "Burkina Faso", lat: 12.36, lng: -1.53, keywords: ["burkina faso", "burkinabe", "ouagadougou"] },
  { code: "NE", name: "Niger", lat: 17.61, lng: 8.08, keywords: ["nigerien", "niamey", "niger republic"] },
  { code: "UZ", name: "Uzbekistan", lat: 41.38, lng: 64.58, keywords: ["uzbekistan", "uzbek", "tashkent"] },
  { code: "KZ", name: "Kazakhstan", lat: 48.02, lng: 66.92, keywords: ["kazakhstan", "kazakh", "astana", "almaty"] },
  { code: "GE", name: "Georgia", lat: 42.32, lng: 43.36, keywords: ["georgia", "georgian", "tbilisi", "abkhazia", "south ossetia"] },
  { code: "AM", name: "Armenia", lat: 40.07, lng: 45.04, keywords: ["armenia", "armenian", "yerevan", "nagorno-karabakh", "karabakh"] },
  { code: "AZ", name: "Azerbaijan", lat: 40.14, lng: 47.58, keywords: ["azerbaijan", "azerbaijani", "baku"] },
  { code: "IT", name: "Italy", lat: 41.87, lng: 12.57, keywords: ["italy", "italian", "rome", "milan", "naples"] },
  { code: "ES", name: "Spain", lat: 40.46, lng: -3.75, keywords: ["spain", "spanish", "madrid", "barcelona", "catalonia"] },
  { code: "GR", name: "Greece", lat: 39.07, lng: 21.82, keywords: ["greece", "greek", "athens"] },
  { code: "HU", name: "Hungary", lat: 47.16, lng: 19.50, keywords: ["hungary", "hungarian", "budapest", "orban"] },
  { code: "SE", name: "Sweden", lat: 60.13, lng: 18.64, keywords: ["sweden", "swedish", "stockholm"] },
  { code: "NO", name: "Norway", lat: 60.47, lng: 8.47, keywords: ["norway", "norwegian", "oslo"] },
  { code: "CA", name: "Canada", lat: 56.13, lng: -106.35, keywords: ["canada", "canadian", "ottawa", "toronto", "trudeau"] },
  { code: "AU", name: "Australia", lat: -25.27, lng: 133.78, keywords: ["australia", "australian", "canberra", "sydney", "melbourne"] },
  { code: "NZ", name: "New Zealand", lat: -40.90, lng: 174.89, keywords: ["new zealand", "kiwi", "wellington", "auckland"] },
  { code: "PT", name: "Portugal", lat: 39.40, lng: -8.22, keywords: ["portugal", "portuguese", "lisbon"] },
  { code: "NL", name: "Netherlands", lat: 52.13, lng: 5.29, keywords: ["netherlands", "dutch", "amsterdam", "the hague", "hague"] },
  { code: "BE", name: "Belgium", lat: 50.50, lng: 4.47, keywords: ["belgium", "belgian", "brussels", "nato hq"] },
  { code: "CH", name: "Switzerland", lat: 46.82, lng: 8.23, keywords: ["switzerland", "swiss", "geneva", "zurich", "davos"] },
  { code: "AT", name: "Austria", lat: 47.52, lng: 14.55, keywords: ["austria", "austrian", "vienna"] },
  { code: "CZ", name: "Czech Republic", lat: 49.82, lng: 15.47, keywords: ["czech", "prague"] },
  { code: "RO", name: "Romania", lat: 45.94, lng: 24.97, keywords: ["romania", "romanian", "bucharest"] },
  { code: "BG", name: "Bulgaria", lat: 42.73, lng: 25.49, keywords: ["bulgaria", "bulgarian", "sofia"] },
  { code: "RS", name: "Serbia", lat: 44.02, lng: 21.01, keywords: ["serbia", "serbian", "belgrade", "kosovo"] },
  { code: "HR", name: "Croatia", lat: 45.10, lng: 15.20, keywords: ["croatia", "croatian", "zagreb"] },
  { code: "SK", name: "Slovakia", lat: 48.67, lng: 19.70, keywords: ["slovakia", "slovak", "bratislava"] },
  { code: "FI", name: "Finland", lat: 61.92, lng: 25.75, keywords: ["finland", "finnish", "helsinki"] },
  { code: "DK", name: "Denmark", lat: 56.26, lng: 9.50, keywords: ["denmark", "danish", "copenhagen"] },
  { code: "IE", name: "Ireland", lat: 53.41, lng: -8.24, keywords: ["ireland", "irish", "dublin"] },
];

/** Build a fast lowercase-keyword → country lookup */
export const KEYWORD_MAP: Map<string, CountryInfo> = new Map();
for (const country of COUNTRIES) {
  // Index by code
  KEYWORD_MAP.set(country.code.toLowerCase(), country);
  // Index by name
  KEYWORD_MAP.set(country.name.toLowerCase(), country);
  // Index by each keyword
  for (const kw of country.keywords) {
    if (!KEYWORD_MAP.has(kw)) {
      KEYWORD_MAP.set(kw, country);
    }
  }
}

/** Convert lat/lng to percentage position on the worldMill map using Miller cylindrical projection */
export function latLngToPercent(lat: number, lng: number): { x: number; y: number } {
  const xPct = ((lng + 180) / 360) * 100;

  // Miller cylindrical y = (5/4) * ln(tan(π/4 + 2φ/5))
  const latRad = (lat * Math.PI) / 180;
  const millerY = (5 / 4) * Math.log(Math.tan(Math.PI / 4 + (2 / 5) * latRad));

  // worldMill typically spans from about Miller y=-2.1 to y=2.3
  const millerYMin = -2.1;
  const millerYMax = 2.3;
  const yPct = (1 - (millerY - millerYMin) / (millerYMax - millerYMin)) * 100;

  return { x: Math.max(0, Math.min(100, xPct)), y: Math.max(0, Math.min(100, yPct)) };
}

/** Deduplicate the country list (some codes appear twice due to copy-paste) */
const seen = new Set<string>();
export const UNIQUE_COUNTRIES = COUNTRIES.filter((c) => {
  if (seen.has(c.code)) return false;
  seen.add(c.code);
  return true;
});
