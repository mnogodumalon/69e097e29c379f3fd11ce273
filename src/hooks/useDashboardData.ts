import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Schichttypen, Schichtplanung, Mitarbeiter } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';

export function useDashboardData() {
  const [schichttypen, setSchichttypen] = useState<Schichttypen[]>([]);
  const [schichtplanung, setSchichtplanung] = useState<Schichtplanung[]>([]);
  const [mitarbeiter, setMitarbeiter] = useState<Mitarbeiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [schichttypenData, schichtplanungData, mitarbeiterData] = await Promise.all([
        LivingAppsService.getSchichttypen(),
        LivingAppsService.getSchichtplanung(),
        LivingAppsService.getMitarbeiter(),
      ]);
      setSchichttypen(schichttypenData);
      setSchichtplanung(schichtplanungData);
      setMitarbeiter(mitarbeiterData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Fehler beim Laden der Daten'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Silent background refresh (no loading state change → no flicker)
  useEffect(() => {
    async function silentRefresh() {
      try {
        const [schichttypenData, schichtplanungData, mitarbeiterData] = await Promise.all([
          LivingAppsService.getSchichttypen(),
          LivingAppsService.getSchichtplanung(),
          LivingAppsService.getMitarbeiter(),
        ]);
        setSchichttypen(schichttypenData);
        setSchichtplanung(schichtplanungData);
        setMitarbeiter(mitarbeiterData);
      } catch {
        // silently ignore — stale data is better than no data
      }
    }
    function handleRefresh() { void silentRefresh(); }
    window.addEventListener('dashboard-refresh', handleRefresh);
    return () => window.removeEventListener('dashboard-refresh', handleRefresh);
  }, []);

  const schichttypenMap = useMemo(() => {
    const m = new Map<string, Schichttypen>();
    schichttypen.forEach(r => m.set(r.record_id, r));
    return m;
  }, [schichttypen]);

  const mitarbeiterMap = useMemo(() => {
    const m = new Map<string, Mitarbeiter>();
    mitarbeiter.forEach(r => m.set(r.record_id, r));
    return m;
  }, [mitarbeiter]);

  return { schichttypen, setSchichttypen, schichtplanung, setSchichtplanung, mitarbeiter, setMitarbeiter, loading, error, fetchAll, schichttypenMap, mitarbeiterMap };
}