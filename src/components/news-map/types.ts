export type EventSeverity = "high" | "medium" | "low";
export type EventCategory = "violent" | "minor" | "economic";

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
}
