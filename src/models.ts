export interface PersonHit {
  id: string;
  name: string;
  occupation: string | null;
  address: string | null;
  postal_station: string | null;
  detail_path: string;
}

export interface BusinessHit {
  id: string;
  cluster_key: string;
  is_branch: boolean;
  name: string;
  occupation: string | null;
  company_types: string[];
  address: string | null;
  postal_station: string | null;
  logo_url: string | null;
  detail_path: string;
}

export interface Section<T> {
  total: number;
  first_item: number | null;
  last_item: number | null;
  next_start: number | null;
  items: T[];
}

export interface SearchResponse {
  query: string;
  people?: Section<PersonHit>;
  businesses?: Section<BusinessHit>;
}

export interface Phone {
  label: string;
  number: string;
  display: string;
  // Bannmerking: the owner has opted out of marketing calls to this number.
  marketing_ban: boolean;
}

export interface Location {
  lat: number;
  lon: number;
}

export interface OpeningHour {
  day: string;
  hours: string;
  note: string | null;
}

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phones: string[];
  open_status: string | null;
  detail_path: string;
}

export interface Entity {
  kind: "person" | "business";
  id: string;
  name: string;
  occupation: string | null;
  address: string | null;
  postal_station: string | null;
  phones: Phone[];
  email: string | null;
  website: string | null;
  kennitala: string | null;
  social_media: string[];
  location: Location | null;
  open_status: string | null;
  opening_hours: OpeningHour[];
  branches: Branch[];
  // Every label/value pair from the info box, untouched, for fields not mapped above.
  fields: Record<string, string[]>;
  source_url: string;
}
