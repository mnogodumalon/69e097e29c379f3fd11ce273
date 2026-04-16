import type { EnrichedSchichtplanung } from '@/types/enriched';
import type { Mitarbeiter, Schichtplanung, Schichttypen } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveDisplay(url: unknown, map: Map<string, any>, ...fields: string[]): string {
  if (!url) return '';
  const id = extractRecordId(url);
  if (!id) return '';
  const r = map.get(id);
  if (!r) return '';
  return fields.map(f => String(r.fields[f] ?? '')).join(' ').trim();
}

interface SchichtplanungMaps {
  mitarbeiterMap: Map<string, Mitarbeiter>;
  schichttypenMap: Map<string, Schichttypen>;
}

export function enrichSchichtplanung(
  schichtplanung: Schichtplanung[],
  maps: SchichtplanungMaps
): EnrichedSchichtplanung[] {
  return schichtplanung.map(r => ({
    ...r,
    mitarbeiter_auswahlName: resolveDisplay(r.fields.mitarbeiter_auswahl, maps.mitarbeiterMap, 'vorname', 'nachname'),
    schicht_auswahlName: resolveDisplay(r.fields.schicht_auswahl, maps.schichttypenMap, 'schichtname'),
  }));
}
