import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Schichtplanung } from '@/types/app';
import { LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { useDashboardData } from '@/hooks/useDashboardData';
import { IntentWizardShell } from '@/components/IntentWizardShell';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  IconCalendar,
  IconCheck,
  IconX,
  IconLoader2,
  IconAlertCircle,
  IconRefresh,
  IconChevronRight,
} from '@tabler/icons-react';
import { format, startOfWeek, endOfWeek, parseISO, isValid } from 'date-fns';
import { de } from 'date-fns/locale';

// ── helpers ──────────────────────────────────────────────────────────────────

function toDateString(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function currentWeekStart(): string {
  return toDateString(startOfWeek(new Date(), { weekStartsOn: 1 }));
}

function currentWeekEnd(): string {
  return toDateString(endOfWeek(new Date(), { weekStartsOn: 1 }));
}

function formatDayLabel(dateStr: string): string {
  const d = parseISO(dateStr);
  if (!isValid(d)) return dateStr;
  return format(d, 'EEEE, dd.MM.yyyy', { locale: de });
}

function formatShortDay(dateStr: string): string {
  const d = parseISO(dateStr);
  if (!isValid(d)) return dateStr;
  return format(d, 'EE dd.MM.', { locale: de });
}

const STATUS_OPTIONS = LOOKUP_OPTIONS['schichtplanung']?.status ?? [];

function statusLabel(key: string | undefined): string {
  if (!key) return '—';
  return STATUS_OPTIONS.find(o => o.key === key)?.label ?? key;
}

function getStatusKey(s: Schichtplanung['fields']['status']): string | undefined {
  if (!s) return undefined;
  if (typeof s === 'object' && 'key' in s) return s.key;
  return s as string;
}

// ── wizard steps config ───────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { label: 'Woche wählen' },
  { label: 'Status aktualisieren' },
  { label: 'Zusammenfassung' },
];

// ── local types ───────────────────────────────────────────────────────────────

interface PendingChange {
  recordId: string;
  status?: string;
  notiz?: string;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function WochenplanungPage() {
  const [searchParams] = useSearchParams();

  // step state — read from URL on mount
  const initialStep = (() => {
    const s = parseInt(searchParams.get('step') ?? '', 10);
    return s >= 1 && s <= 3 ? s : 1;
  })();
  const [currentStep, setCurrentStep] = useState(initialStep);

  // step 1 filters
  const [wochenbeginn, setWochenbeginn] = useState(currentWeekStart);
  const [wochenende, setWochenende] = useState(currentWeekEnd);
  const [filterAbteilung, setFilterAbteilung] = useState('');
  const [filterStandort, setFilterStandort] = useState('');

  // step 2 data
  const [weekEntries, setWeekEntries] = useState<Schichtplanung[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [saving, setSaving] = useState(false);

  // step 3 summary
  const [savedCount, setSavedCount] = useState(0);
  const [savedBreakdown, setSavedBreakdown] = useState<{ bestaetigt: number; abgesagt: number; unveraendert: number }>({
    bestaetigt: 0,
    abgesagt: 0,
    unveraendert: 0,
  });

  // base data from hook (for Mitarbeiter and Schichttypen lookups)
  const { mitarbeiter, schichttypen, loading: baseLoading, error: baseError, fetchAll } = useDashboardData();

  // ── lookup maps ─────────────────────────────────────────────────────────────
  const mitarbeiterMap = useMemo(() => {
    const m = new Map<string, string>();
    mitarbeiter.forEach(r => {
      const name = [r.fields.vorname, r.fields.nachname].filter(Boolean).join(' ') || r.record_id;
      m.set(r.record_id, name);
    });
    return m;
  }, [mitarbeiter]);

  const schichttypenMap = useMemo(() => {
    const m = new Map<string, string>();
    schichttypen.forEach(r => {
      m.set(r.record_id, r.fields.schichtname ?? r.record_id);
    });
    return m;
  }, [schichttypen]);

  // ── load week entries ────────────────────────────────────────────────────────
  const loadWeekEntries = useCallback(async () => {
    setLoadingEntries(true);
    setLoadError(null);
    try {
      await fetchAll();
      const all = await LivingAppsService.getSchichtplanung();
      let filtered = all.filter(e => {
        const d = e.fields.datum;
        if (!d) return false;
        const day = d.slice(0, 10);
        return day >= wochenbeginn && day <= wochenende;
      });
      if (filterAbteilung.trim()) {
        const ab = filterAbteilung.trim().toLowerCase();
        filtered = filtered.filter(e => (e.fields.abteilung_plan ?? '').toLowerCase().includes(ab));
      }
      if (filterStandort.trim()) {
        const st = filterStandort.trim().toLowerCase();
        filtered = filtered.filter(e => (e.fields.standort ?? '').toLowerCase().includes(st));
      }
      // Sort by date then by employee name
      filtered.sort((a, b) => {
        const da = a.fields.datum ?? '';
        const db = b.fields.datum ?? '';
        if (da !== db) return da.localeCompare(db);
        const ma = extractRecordId(a.fields.mitarbeiter_auswahl) ?? '';
        const mb = extractRecordId(b.fields.mitarbeiter_auswahl) ?? '';
        const na = mitarbeiterMap.get(ma) ?? '';
        const nb = mitarbeiterMap.get(mb) ?? '';
        return na.localeCompare(nb);
      });
      setWeekEntries(filtered);
      setPendingChanges(new Map());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Fehler beim Laden der Schichtdaten');
    } finally {
      setLoadingEntries(false);
    }
  }, [wochenbeginn, wochenende, filterAbteilung, filterStandort, fetchAll, mitarbeiterMap]);

  // ── quick stats ──────────────────────────────────────────────────────────────
  const weekStats = useMemo(() => {
    const counts = { geplant: 0, bestaetigt: 0, abwesend: 0, vertreter: 0, sonstige: 0 };
    weekEntries.forEach(e => {
      const key = getStatusKey(e.fields.status);
      if (key === 'geplant') counts.geplant++;
      else if (key === 'bestaetigt') counts.bestaetigt++;
      else if (key === 'abwesend') counts.abwesend++;
      else if (key === 'vertreter') counts.vertreter++;
      else counts.sonstige++;
    });
    return counts;
  }, [weekEntries]);

  // ── pending changes helpers ──────────────────────────────────────────────────
  const setEntryStatus = useCallback((recordId: string, status: string) => {
    setPendingChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(recordId) ?? { recordId };
      next.set(recordId, { ...existing, status });
      return next;
    });
  }, []);

  const setEntryNotiz = useCallback((recordId: string, notiz: string) => {
    setPendingChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(recordId) ?? { recordId };
      next.set(recordId, { ...existing, notiz });
      return next;
    });
  }, []);

  const clearEntryStatus = useCallback((recordId: string) => {
    setPendingChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(recordId);
      if (!existing) return prev;
      const withoutStatus: PendingChange = { recordId: existing.recordId };
      if (existing.notiz !== undefined) withoutStatus.notiz = existing.notiz;
      if (!withoutStatus.notiz) {
        next.delete(recordId);
      } else {
        next.set(recordId, withoutStatus);
      }
      return next;
    });
  }, []);

  const bulkSetStatus = useCallback((status: string, onlyStatus?: string) => {
    setPendingChanges(prev => {
      const next = new Map(prev);
      weekEntries.forEach(e => {
        const currentStatus = getStatusKey(e.fields.status);
        if (onlyStatus && currentStatus !== onlyStatus) return;
        const existing = next.get(e.record_id) ?? { recordId: e.record_id };
        next.set(e.record_id, { ...existing, status });
      });
      return next;
    });
  }, [weekEntries]);

  const pendingCount = useMemo(() => pendingChanges.size, [pendingChanges]);

  // ── save changes ─────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (pendingChanges.size === 0) return;
    setSaving(true);
    let bestaetigt = 0;
    let abgesagt = 0;
    try {
      const promises = Array.from(pendingChanges.values()).map(async change => {
        const entry = weekEntries.find(e => e.record_id === change.recordId);
        if (!entry) return;
        const updates: Partial<Schichtplanung['fields']> = {};
        if (change.status !== undefined) {
          (updates as Record<string, unknown>).status = change.status;
          if (change.status === 'bestaetigt') bestaetigt++;
          else if (change.status === 'abgesagt') abgesagt++;
        }
        if (change.notiz !== undefined) {
          updates.notiz = change.notiz;
        }
        await LivingAppsService.updateSchichtplanungEntry(entry.record_id, updates as Schichtplanung['fields']);
      });
      await Promise.all(promises);
      const total = pendingChanges.size;
      const unveraendert = weekEntries.length - total;
      setSavedCount(total);
      setSavedBreakdown({ bestaetigt, abgesagt, unveraendert: Math.max(0, unveraendert) });
      setPendingChanges(new Map());
      setCurrentStep(3);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  }, [pendingChanges, weekEntries]);

  // ── group entries by date ────────────────────────────────────────────────────
  const entriesByDate = useMemo(() => {
    const grouped = new Map<string, Schichtplanung[]>();
    weekEntries.forEach(e => {
      const d = (e.fields.datum ?? '').slice(0, 10);
      if (!grouped.has(d)) grouped.set(d, []);
      grouped.get(d)!.push(e);
    });
    return grouped;
  }, [weekEntries]);

  const sortedDates = useMemo(() => Array.from(entriesByDate.keys()).sort(), [entriesByDate]);

  // ── step navigation ──────────────────────────────────────────────────────────
  const handleGoToStep2 = useCallback(async () => {
    setCurrentStep(2);
    await loadWeekEntries();
  }, [loadWeekEntries]);

  const handleReset = useCallback(() => {
    setWochenbeginn(currentWeekStart());
    setWochenende(currentWeekEnd());
    setFilterAbteilung('');
    setFilterStandort('');
    setWeekEntries([]);
    setPendingChanges(new Map());
    setSavedCount(0);
    setCurrentStep(1);
  }, []);

  // Reload entries when returning to step 2 if data not yet loaded
  useEffect(() => {
    if (currentStep === 2 && weekEntries.length === 0 && !loadingEntries) {
      loadWeekEntries();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // ── render ────────────────────────────────────────────────────────────────────

  const shellError = baseError ? baseError : null;

  return (
    <IntentWizardShell
      title="Wochenplanung verwalten"
      subtitle="Schichtstatus für eine Woche aktualisieren und bestätigen"
      steps={WIZARD_STEPS}
      currentStep={currentStep}
      onStepChange={setCurrentStep}
      loading={baseLoading}
      error={shellError}
      onRetry={fetchAll}
    >
      {/* ── STEP 1: Woche auswählen ────────────────────────────────────────── */}
      {currentStep === 1 && (
        <Card className="overflow-hidden">
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconCalendar size={20} className="text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Woche auswählen</h2>
                <p className="text-sm text-muted-foreground">Wähle den Zeitraum und optionale Filter</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="wochenbeginn">Wochenbeginn</Label>
                <Input
                  id="wochenbeginn"
                  type="date"
                  value={wochenbeginn}
                  onChange={e => setWochenbeginn(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wochenende">Wochenende</Label>
                <Input
                  id="wochenende"
                  type="date"
                  value={wochenende}
                  onChange={e => setWochenende(e.target.value)}
                />
              </div>
            </div>

            <div className="border-t pt-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Optionale Filter
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="filterAbteilung">Abteilung</Label>
                  <Input
                    id="filterAbteilung"
                    placeholder="z.B. Produktion"
                    value={filterAbteilung}
                    onChange={e => setFilterAbteilung(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filterStandort">Standort</Label>
                  <Input
                    id="filterStandort"
                    placeholder="z.B. Berlin"
                    value={filterStandort}
                    onChange={e => setFilterStandort(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={handleGoToStep2}
                disabled={!wochenbeginn || !wochenende}
                className="gap-2"
              >
                Schichten laden
                <IconChevronRight size={16} />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: Status aktualisieren ──────────────────────────────────── */}
      {currentStep === 2 && (
        <div className="space-y-4">
          {/* Header bar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-semibold text-base">
                {wochenbeginn && wochenende
                  ? `${format(parseISO(wochenbeginn), 'dd.MM.', { locale: de })} – ${format(parseISO(wochenende), 'dd.MM.yyyy', { locale: de })}`
                  : 'Schichtwoche'}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {loadingEntries
                  ? 'Lade Einträge...'
                  : `${weekEntries.length} Schichten gefunden`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadWeekEntries}
              disabled={loadingEntries}
              className="gap-2 self-start sm:self-auto"
            >
              {loadingEntries ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconRefresh size={14} />
              )}
              Aktualisieren
            </Button>
          </div>

          {/* Loading state */}
          {loadingEntries && (
            <Card className="overflow-hidden">
              <CardContent className="p-8 flex flex-col items-center gap-3">
                <IconLoader2 size={32} className="text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Lade Schichtdaten...</p>
              </CardContent>
            </Card>
          )}

          {/* Error state */}
          {!loadingEntries && loadError && (
            <Card className="overflow-hidden border-destructive/30">
              <CardContent className="p-6 flex items-center gap-3">
                <IconAlertCircle size={20} className="text-destructive shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-sm">Fehler beim Laden</p>
                  <p className="text-sm text-muted-foreground truncate">{loadError}</p>
                </div>
                <Button variant="outline" size="sm" onClick={loadWeekEntries} className="ml-auto shrink-0">
                  Erneut versuchen
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Quick stats + bulk actions */}
          {!loadingEntries && !loadError && weekEntries.length > 0 && (
            <>
              {/* Stats bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Geplant', count: weekStats.geplant, key: 'geplant', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                  { label: 'Bestätigt', count: weekStats.bestaetigt, key: 'bestaetigt', color: 'bg-green-50 text-green-700 border-green-200' },
                  { label: 'Abwesend', count: weekStats.abwesend, key: 'abwesend', color: 'bg-red-50 text-red-700 border-red-200' },
                  { label: 'Vertreter', count: weekStats.vertreter, key: 'vertreter', color: 'bg-amber-50 text-amber-700 border-amber-200' },
                ].map(s => (
                  <div key={s.key} className={`rounded-lg border px-3 py-2 text-center ${s.color}`}>
                    <div className="text-lg font-bold">{s.count}</div>
                    <div className="text-xs font-medium">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Bulk actions */}
              <Card className="overflow-hidden">
                <CardContent className="p-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                    Massenaktionen
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => bulkSetStatus('bestaetigt')}
                      className="gap-2"
                    >
                      <IconCheck size={14} className="text-green-600" />
                      Alle bestätigen
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => bulkSetStatus('bestaetigt', 'geplant')}
                      className="gap-2"
                    >
                      <IconCheck size={14} className="text-green-600" />
                      Alle Geplanten bestätigen
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Pending indicator */}
              {pendingCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                  <IconAlertCircle size={16} className="shrink-0" />
                  <span className="font-medium">{pendingCount} Änderung{pendingCount !== 1 ? 'en' : ''} ausstehend</span>
                  <span className="text-amber-600">— noch nicht gespeichert</span>
                </div>
              )}

              {/* Entries grouped by date */}
              <div className="space-y-6">
                {sortedDates.map(dateStr => {
                  const entries = entriesByDate.get(dateStr) ?? [];
                  return (
                    <div key={dateStr}>
                      {/* Date section header */}
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <IconCalendar size={14} className="text-muted-foreground" />
                        </div>
                        <h3 className="font-semibold text-sm">{formatDayLabel(dateStr)}</h3>
                        <span className="text-xs text-muted-foreground">({entries.length} Schicht{entries.length !== 1 ? 'en' : ''})</span>
                      </div>

                      <div className="space-y-2">
                        {entries.map(entry => {
                          const mitarbeiterId = extractRecordId(entry.fields.mitarbeiter_auswahl);
                          const schichtId = extractRecordId(entry.fields.schicht_auswahl);
                          const mitarbeiterName = (mitarbeiterId && mitarbeiterMap.get(mitarbeiterId)) ?? '—';
                          const schichtName = (schichtId && schichttypenMap.get(schichtId)) ?? '—';
                          const originalStatusKey = getStatusKey(entry.fields.status);
                          const pending = pendingChanges.get(entry.record_id);
                          const displayStatusKey = pending?.status ?? originalStatusKey;
                          const hasPendingStatus = pending?.status !== undefined && pending.status !== originalStatusKey;
                          const hasPendingNotiz = pending?.notiz !== undefined;
                          const hasAnyPending = hasPendingStatus || hasPendingNotiz;

                          return (
                            <Card
                              key={entry.record_id}
                              className={`overflow-hidden transition-colors ${hasAnyPending ? 'border-amber-300 bg-amber-50/30' : ''}`}
                            >
                              <CardContent className="p-4">
                                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                                  {/* Left: info */}
                                  <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-sm truncate">{mitarbeiterName}</span>
                                      {hasAnyPending && (
                                        <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">
                                          geändert
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                                      <span className="truncate">{schichtName}</span>
                                      <span className="text-muted-foreground/40">·</span>
                                      <span className="shrink-0">{formatShortDay(dateStr)}</span>
                                    </div>
                                    {(entry.fields.abteilung_plan || entry.fields.standort) && (
                                      <div className="text-xs text-muted-foreground">
                                        {[entry.fields.abteilung_plan, entry.fields.standort].filter(Boolean).join(' · ')}
                                      </div>
                                    )}
                                    <div className="pt-1">
                                      <StatusBadge
                                        statusKey={displayStatusKey}
                                        label={statusLabel(displayStatusKey)}
                                      />
                                    </div>
                                  </div>

                                  {/* Right: action buttons */}
                                  <div className="flex flex-row sm:flex-col gap-2 shrink-0">
                                    <Button
                                      size="sm"
                                      variant={displayStatusKey === 'bestaetigt' ? 'default' : 'outline'}
                                      className="gap-1.5 h-8"
                                      onClick={() => {
                                        if (displayStatusKey === 'bestaetigt') {
                                          clearEntryStatus(entry.record_id);
                                        } else {
                                          setEntryStatus(entry.record_id, 'bestaetigt');
                                        }
                                      }}
                                    >
                                      <IconCheck size={13} />
                                      Bestätigen
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant={displayStatusKey === 'abgesagt' ? 'destructive' : 'outline'}
                                      className="gap-1.5 h-8"
                                      onClick={() => {
                                        if (displayStatusKey === 'abgesagt') {
                                          clearEntryStatus(entry.record_id);
                                        } else {
                                          setEntryStatus(entry.record_id, 'abgesagt');
                                        }
                                      }}
                                    >
                                      <IconX size={13} />
                                      Absagen
                                    </Button>
                                  </div>
                                </div>

                                {/* Notiz field */}
                                <div className="mt-3 pt-3 border-t">
                                  <Textarea
                                    placeholder="Notiz hinzufügen (optional)..."
                                    value={pending?.notiz ?? entry.fields.notiz ?? ''}
                                    onChange={e => setEntryNotiz(entry.record_id, e.target.value)}
                                    rows={1}
                                    className="text-sm resize-none"
                                  />
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Empty state */}
          {!loadingEntries && !loadError && weekEntries.length === 0 && (
            <Card className="overflow-hidden">
              <CardContent className="p-12 flex flex-col items-center gap-3 text-center">
                <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                  <IconCalendar size={22} className="text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">Keine Schichten gefunden</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Für den gewählten Zeitraum sind keine Schichteinträge vorhanden.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setCurrentStep(1)}>
                  Anderen Zeitraum wählen
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Bottom action bar */}
          {!loadingEntries && !loadError && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(1)}
              >
                Zurück
              </Button>
              <div className="flex items-center gap-3">
                {pendingCount > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {pendingCount} Änderung{pendingCount !== 1 ? 'en' : ''} ausstehend
                  </span>
                )}
                <Button
                  onClick={handleSave}
                  disabled={saving || pendingCount === 0}
                  className="gap-2"
                >
                  {saving ? (
                    <>
                      <IconLoader2 size={15} className="animate-spin" />
                      Speichern...
                    </>
                  ) : (
                    <>
                      <IconCheck size={15} />
                      Änderungen speichern
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: Zusammenfassung ────────────────────────────────────────── */}
      {currentStep === 3 && (
        <div className="space-y-6">
          {/* Success header */}
          <Card className="overflow-hidden border-green-200 bg-green-50/50">
            <CardContent className="p-6 flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-green-100 flex items-center justify-center shrink-0">
                <IconCheck size={24} className="text-green-600" />
              </div>
              <div>
                <h2 className="font-semibold text-base text-green-800">
                  {savedCount} Einträge wurden aktualisiert
                </h2>
                <p className="text-sm text-green-700 mt-1">
                  Alle Änderungen wurden erfolgreich gespeichert.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Breakdown */}
          <Card className="overflow-hidden">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-semibold text-sm">Zusammenfassung der Woche</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-green-700">{savedBreakdown.bestaetigt}</div>
                  <div className="text-xs font-medium text-green-600 mt-0.5">Bestätigt</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-red-700">{savedBreakdown.abgesagt}</div>
                  <div className="text-xs font-medium text-red-600 mt-0.5">Abgesagt</div>
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-muted-foreground">{savedBreakdown.unveraendert}</div>
                  <div className="text-xs font-medium text-muted-foreground mt-0.5">Unverändert</div>
                </div>
              </div>

              {/* Week stats after save */}
              <div className="border-t pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Wochenübersicht ({wochenbeginn && wochenende
                    ? `${format(parseISO(wochenbeginn), 'dd.MM.', { locale: de })} – ${format(parseISO(wochenende), 'dd.MM.yyyy', { locale: de })}`
                    : ''}
                  )
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: 'Gesamt', count: weekEntries.length, color: 'bg-slate-50 text-slate-700 border-slate-200' },
                    { label: 'Geplant', count: weekStats.geplant, color: 'bg-blue-50 text-blue-700 border-blue-200' },
                    { label: 'Bestätigt', count: weekStats.bestaetigt, color: 'bg-green-50 text-green-700 border-green-200' },
                    { label: 'Abwesend', count: weekStats.abwesend, color: 'bg-red-50 text-red-700 border-red-200' },
                  ].map(s => (
                    <div key={s.label} className={`rounded-lg border px-3 py-2 text-center ${s.color}`}>
                      <div className="text-lg font-bold">{s.count}</div>
                      <div className="text-xs font-medium">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              onClick={handleReset}
              className="gap-2"
            >
              <IconRefresh size={15} />
              Neue Woche verwalten
            </Button>
            <Button
              variant="outline"
              asChild
            >
              <a href="#/schichtplanung">
                Zur Schichtplanung
              </a>
            </Button>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
