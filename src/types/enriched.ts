import type { Schichtplanung } from './app';

export type EnrichedSchichtplanung = Schichtplanung & {
  mitarbeiter_auswahlName: string;
  schicht_auswahlName: string;
};
