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
}
