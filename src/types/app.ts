// AUTOMATICALLY GENERATED TYPES - DO NOT EDIT

export type LookupValue = { key: string; label: string };
export type GeoLocation = { lat: number; long: number; info?: string };

export interface Mitarbeiter {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    vorname?: string;
    nachname?: string;
    personalnummer?: string;
    abteilung?: string;
    position?: string;
    telefon?: string;
    email?: string;
    beschaeftigungsart?: LookupValue;
    eintrittsdatum?: string; // Format: YYYY-MM-DD oder ISO String
    bemerkung?: string;
  };
}

export interface Schichttypen {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    schichtname?: string;
    kuerzel?: string;
    beginn?: string;
    ende?: string;
    pausenzeit?: number;
    schichtfarbe?: LookupValue;
    schichtbeschreibung?: string;
  };
}

export interface Schichtplanung {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    datum?: string; // Format: YYYY-MM-DD oder ISO String
    mitarbeiter_auswahl?: string; // applookup -> URL zu 'Mitarbeiter' Record
    schicht_auswahl?: string; // applookup -> URL zu 'Schichttypen' Record
    abteilung_plan?: string;
    standort?: string;
    status?: LookupValue;
    notiz?: string;
  };
}

export const APP_IDS = {
  MITARBEITER: '69e097c277a4b6a9f22fc8b8',
  SCHICHTTYPEN: '69e097c9a03f69a98e0e1097',
  SCHICHTPLANUNG: '69e097cadc9ffe760d7e284f',
} as const;


export const LOOKUP_OPTIONS: Record<string, Record<string, {key: string, label: string}[]>> = {
  'mitarbeiter': {
    beschaeftigungsart: [{ key: "vollzeit", label: "Vollzeit" }, { key: "teilzeit", label: "Teilzeit" }, { key: "minijob", label: "Minijob" }, { key: "aushilfe", label: "Aushilfe" }, { key: "praktikant", label: "Praktikant" }],
  },
  'schichttypen': {
    schichtfarbe: [{ key: "gruen", label: "Grün (Frühschicht)" }, { key: "gelb", label: "Gelb (Spätschicht)" }, { key: "blau", label: "Blau (Nachtschicht)" }, { key: "grau", label: "Grau (Sonstige)" }, { key: "rot", label: "Rot (Sonderfall)" }],
  },
  'schichtplanung': {
    status: [{ key: "geplant", label: "Geplant" }, { key: "bestaetigt", label: "Bestätigt" }, { key: "abwesend", label: "Abwesend" }, { key: "vertreter", label: "Vertreter" }],
  },
};

export const FIELD_TYPES: Record<string, Record<string, string>> = {
  'mitarbeiter': {
    'vorname': 'string/text',
    'nachname': 'string/text',
    'personalnummer': 'string/text',
    'abteilung': 'string/text',
    'position': 'string/text',
    'telefon': 'string/tel',
    'email': 'string/email',
    'beschaeftigungsart': 'lookup/select',
    'eintrittsdatum': 'date/date',
    'bemerkung': 'string/textarea',
  },
  'schichttypen': {
    'schichtname': 'string/text',
    'kuerzel': 'string/text',
    'beginn': 'string/text',
    'ende': 'string/text',
    'pausenzeit': 'number',
    'schichtfarbe': 'lookup/select',
    'schichtbeschreibung': 'string/textarea',
  },
  'schichtplanung': {
    'datum': 'date/date',
    'mitarbeiter_auswahl': 'applookup/select',
    'schicht_auswahl': 'applookup/select',
    'abteilung_plan': 'string/text',
    'standort': 'string/text',
    'status': 'lookup/select',
    'notiz': 'string/textarea',
  },
};

type StripLookup<T> = {
  [K in keyof T]: T[K] extends LookupValue | undefined ? string | LookupValue | undefined
    : T[K] extends LookupValue[] | undefined ? string[] | LookupValue[] | undefined
    : T[K];
};

// Helper Types for creating new records (lookup fields as plain strings for API)
export type CreateMitarbeiter = StripLookup<Mitarbeiter['fields']>;
export type CreateSchichttypen = StripLookup<Schichttypen['fields']>;
export type CreateSchichtplanung = StripLookup<Schichtplanung['fields']>;