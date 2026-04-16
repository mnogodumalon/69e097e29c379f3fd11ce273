import { useState, useMemo, useCallback } from 'react';
import { IntentWizardShell } from '@/components/IntentWizardShell';
import { StatusBadge } from '@/components/StatusBadge';
import { SchichttypenDialog } from '@/components/dialogs/SchichttypenDialog';
import { MitarbeiterDialog } from '@/components/dialogs/MitarbeiterDialog';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Mitarbeiter, Schichttypen } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  IconPlus,
  IconCalendar,
  IconUsers,
  IconCheck,
  IconChevronRight,
  IconChevronLeft,
  IconLoader2,
  IconCircleCheck,
  IconMapPin,
  IconBuilding,
  IconClock,
  IconRefresh,
} from '@tabler/icons-react';

const WIZARD_STEPS = [
  { label: 'Zeitraum & Schicht' },
  { label: 'Mitarbeiter' },
  { label: 'Vorschau' },
  { label: 'Zusammenfassung' },
];

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date;
}

function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getDaysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return days;
  const cur = new Date(s);
  while (cur <= e) {
    days.push(formatDateYMD(new Date(cur)));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function schichtfarbenColor(key: string | undefined): string {
  switch (key) {
    case 'gruen': return 'bg-green-100 text-green-800 border-green-200';
    case 'gelb': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'blau': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'grau': return 'bg-gray-100 text-gray-800 border-gray-200';
    case 'rot': return 'bg-red-100 text-red-800 border-red-200';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function beschaeftigungsartLabel(key: string | undefined): string {
  switch (key) {
    case 'vollzeit': return 'Vollzeit';
    case 'teilzeit': return 'Teilzeit';
    case 'minijob': return 'Minijob';
    case 'aushilfe': return 'Aushilfe';
    case 'praktikant': return 'Praktikant';
    default: return key ?? '';
  }
}

interface CreatedEntry {
  mitarbeiterName: string;
  mitarbeiterId: string;
  tage: string[];
}

export default function SchichtplanungErstellenPage() {
  const today = new Date();
  const monday = getMonday(today);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  // --- Wizard step state ---
  const [currentStep, setCurrentStep] = useState(1);

  // --- Step 1 state ---
  const [startdatum, setStartdatum] = useState(formatDateYMD(monday));
  const [enddatum, setEnddatum] = useState(formatDateYMD(sunday));
  const [standort, setStandort] = useState('');
  const [abteilung, setAbteilung] = useState('');
  const [selectedSchichtId, setSelectedSchichtId] = useState<string | null>(null);
  const [schichttypenDialogOpen, setSchichttypenDialogOpen] = useState(false);

  // --- Step 2 state ---
  const [selectedMitarbeiterIds, setSelectedMitarbeiterIds] = useState<Set<string>>(new Set());
  const [mitarbeiterSearch, setMitarbeiterSearch] = useState('');
  const [mitarbeiterDialogOpen, setMitarbeiterDialogOpen] = useState(false);

  // --- Step 3/4 state ---
  const [creating, setCreating] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  const [totalToCreate, setTotalToCreate] = useState(0);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [createdEntries, setCreatedEntries] = useState<CreatedEntry[]>([]);

  // --- Data ---
  const { mitarbeiter, schichttypen, loading, error, fetchAll } = useDashboardData();

  // ALL hooks above, early returns below

  const selectedSchicht = useMemo(
    () => schichttypen.find(s => s.record_id === selectedSchichtId) ?? null,
    [schichttypen, selectedSchichtId]
  );

  const filteredMitarbeiter = useMemo(() => {
    let list = mitarbeiter;
    if (abteilung.trim()) {
      list = list.filter(m =>
        m.fields.abteilung?.toLowerCase().includes(abteilung.toLowerCase())
      );
    }
    if (mitarbeiterSearch.trim()) {
      const q = mitarbeiterSearch.toLowerCase();
      list = list.filter(m => {
        const name = `${m.fields.vorname ?? ''} ${m.fields.nachname ?? ''}`.toLowerCase();
        const abt = (m.fields.abteilung ?? '').toLowerCase();
        const pos = (m.fields.position ?? '').toLowerCase();
        return name.includes(q) || abt.includes(q) || pos.includes(q);
      });
    }
    return list;
  }, [mitarbeiter, abteilung, mitarbeiterSearch]);

  const selectedMitarbeiterList: Mitarbeiter[] = useMemo(
    () => mitarbeiter.filter(m => selectedMitarbeiterIds.has(m.record_id)),
    [mitarbeiter, selectedMitarbeiterIds]
  );

  const daysInRange = useMemo(() => getDaysInRange(startdatum, enddatum), [startdatum, enddatum]);
  const totalEntries = selectedMitarbeiterIds.size * daysInRange.length;

  const toggleMitarbeiter = useCallback((id: string) => {
    setSelectedMitarbeiterIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    const allSelected = filteredMitarbeiter.every(m => selectedMitarbeiterIds.has(m.record_id));
    setSelectedMitarbeiterIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        filteredMitarbeiter.forEach(m => next.delete(m.record_id));
      } else {
        filteredMitarbeiter.forEach(m => next.add(m.record_id));
      }
      return next;
    });
  }, [filteredMitarbeiter, selectedMitarbeiterIds]);

  async function handleCreate() {
    if (!selectedSchichtId || selectedMitarbeiterIds.size === 0 || daysInRange.length === 0) return;
    setCreating(true);
    setCreationError(null);
    const total = selectedMitarbeiterList.length * daysInRange.length;
    setTotalToCreate(total);
    setCreatedCount(0);

    const entries: CreatedEntry[] = [];
    let count = 0;

    for (const ma of selectedMitarbeiterList) {
      const tage: string[] = [];
      for (const day of daysInRange) {
        try {
          await LivingAppsService.createSchichtplanungEntry({
            datum: day,
            mitarbeiter_auswahl: createRecordUrl(APP_IDS.MITARBEITER, ma.record_id),
            schicht_auswahl: createRecordUrl(APP_IDS.SCHICHTTYPEN, selectedSchichtId),
            abteilung_plan: abteilung || undefined,
            standort: standort || undefined,
            status: 'geplant',
          });
          tage.push(day);
          count++;
          setCreatedCount(count);
        } catch (err) {
          setCreationError(
            err instanceof Error ? err.message : 'Unbekannter Fehler beim Erstellen eines Eintrags.'
          );
          setCreating(false);
          return;
        }
      }
      entries.push({
        mitarbeiterId: ma.record_id,
        mitarbeiterName: `${ma.fields.vorname ?? ''} ${ma.fields.nachname ?? ''}`.trim(),
        tage,
      });
    }

    setCreatedEntries(entries);
    setCreating(false);
    setCurrentStep(4);
  }

  function handleReset() {
    setCurrentStep(1);
    setStartdatum(formatDateYMD(getMonday(new Date())));
    const sun = new Date(getMonday(new Date()));
    sun.setDate(sun.getDate() + 6);
    setEnddatum(formatDateYMD(sun));
    setStandort('');
    setAbteilung('');
    setSelectedSchichtId(null);
    setSelectedMitarbeiterIds(new Set());
    setMitarbeiterSearch('');
    setCreatedEntries([]);
    setCreatedCount(0);
    setTotalToCreate(0);
    setCreationError(null);
    fetchAll();
  }

  const step1Valid = !!selectedSchichtId && !!startdatum && !!enddatum && startdatum <= enddatum;
  const step2Valid = selectedMitarbeiterIds.size > 0;

  return (
    <IntentWizardShell
      title="Schichtplanung anlegen"
      subtitle="Plane Schichten für mehrere Mitarbeiter auf einmal"
      steps={WIZARD_STEPS}
      currentStep={currentStep}
      onStepChange={setCurrentStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ============================================================ */}
      {/* STEP 1: Zeitraum & Schicht wählen */}
      {/* ============================================================ */}
      {currentStep === 1 && (
        <div className="space-y-6">
          {/* Date range + optional fields */}
          <Card className="overflow-hidden">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <IconCalendar size={18} className="text-primary shrink-0" />
                <span className="font-semibold text-sm">Zeitraum</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="startdatum">Startdatum</Label>
                  <Input
                    id="startdatum"
                    type="date"
                    value={startdatum}
                    onChange={e => setStartdatum(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="enddatum">Enddatum</Label>
                  <Input
                    id="enddatum"
                    type="date"
                    value={enddatum}
                    min={startdatum}
                    onChange={e => setEnddatum(e.target.value)}
                  />
                </div>
              </div>
              {startdatum && enddatum && startdatum <= enddatum && (
                <p className="text-xs text-muted-foreground">
                  {daysInRange.length === 1
                    ? '1 Tag ausgewählt'
                    : `${daysInRange.length} Tage ausgewählt`}
                </p>
              )}
              {startdatum && enddatum && startdatum > enddatum && (
                <p className="text-xs text-destructive">Enddatum muss nach dem Startdatum liegen.</p>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <IconBuilding size={18} className="text-primary shrink-0" />
                <span className="font-semibold text-sm">Optionale Angaben</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="abteilung">Abteilung (optional)</Label>
                  <Input
                    id="abteilung"
                    placeholder="z. B. Lager"
                    value={abteilung}
                    onChange={e => setAbteilung(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="standort">
                    <span className="flex items-center gap-1">
                      <IconMapPin size={13} />
                      Standort (optional)
                    </span>
                  </Label>
                  <Input
                    id="standort"
                    placeholder="z. B. Berlin"
                    value={standort}
                    onChange={e => setStandort(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Schichttypen selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm flex items-center gap-2">
                <IconClock size={18} className="text-primary" />
                Schichttyp auswählen
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSchichttypenDialogOpen(true)}
              >
                <IconPlus size={15} className="mr-1.5" />
                Neu erstellen
              </Button>
            </div>

            {schichttypen.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm">
                Keine Schichttypen vorhanden. Erstelle zuerst einen Schichttyp.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {schichttypen.map(schicht => {
                  const isSelected = selectedSchichtId === schicht.record_id;
                  const farbenKey = typeof schicht.fields.schichtfarbe === 'object'
                    ? schicht.fields.schichtfarbe?.key
                    : schicht.fields.schichtfarbe as string | undefined;
                  return (
                    <button
                      key={schicht.record_id}
                      type="button"
                      onClick={() => setSelectedSchichtId(schicht.record_id)}
                      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border hover:border-primary/40 hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 min-w-0">
                            {farbenKey && (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${schichtfarbenColor(farbenKey)}`}>
                                {schicht.fields.kuerzel ?? farbenKey}
                              </span>
                            )}
                            <span className="font-semibold text-sm truncate">
                              {schicht.fields.schichtname ?? '(Kein Name)'}
                            </span>
                          </div>
                          {(schicht.fields.beginn || schicht.fields.ende) && (
                            <p className="text-xs text-muted-foreground">
                              {schicht.fields.beginn ?? '?'} – {schicht.fields.ende ?? '?'}
                              {schicht.fields.pausenzeit ? ` · ${schicht.fields.pausenzeit} Min. Pause` : ''}
                            </p>
                          )}
                          {schicht.fields.schichtbeschreibung && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {schicht.fields.schichtbeschreibung}
                            </p>
                          )}
                        </div>
                        {isSelected && (
                          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5">
                            <IconCheck size={13} stroke={2.5} className="text-primary-foreground" />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live feedback */}
          {selectedSchicht && step1Valid && (
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 flex items-center gap-3">
              <IconClock size={18} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {selectedSchicht.fields.schichtname}
                  {selectedSchicht.fields.beginn && selectedSchicht.fields.ende
                    ? ` · ${selectedSchicht.fields.beginn} – ${selectedSchicht.fields.ende}`
                    : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {daysInRange.length === 1 ? '1 Tag' : `${daysInRange.length} Tage`}
                  {standort ? ` · ${standort}` : ''}
                  {abteilung ? ` · ${abteilung}` : ''}
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              disabled={!step1Valid}
              onClick={() => setCurrentStep(2)}
              className="gap-2"
            >
              Weiter
              <IconChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 2: Mitarbeiter auswählen */}
      {/* ============================================================ */}
      {currentStep === 2 && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <Input
                placeholder="Mitarbeiter suchen..."
                value={mitarbeiterSearch}
                onChange={e => setMitarbeiterSearch(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setMitarbeiterDialogOpen(true)}
              className="shrink-0"
            >
              <IconPlus size={15} className="mr-1.5" />
              Neu erstellen
            </Button>
          </div>

          {/* Counter */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconUsers size={16} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {selectedMitarbeiterIds.size === 0
                  ? 'Kein Mitarbeiter ausgewählt'
                  : `${selectedMitarbeiterIds.size} Mitarbeiter ausgewählt`}
              </span>
            </div>
            {filteredMitarbeiter.length > 0 && (
              <button
                type="button"
                onClick={toggleAllVisible}
                className="text-xs text-primary hover:underline"
              >
                {filteredMitarbeiter.every(m => selectedMitarbeiterIds.has(m.record_id))
                  ? 'Alle abwählen'
                  : 'Alle auswählen'}
              </button>
            )}
          </div>

          {abteilung && (
            <p className="text-xs text-muted-foreground -mt-2">
              Gefiltert nach Abteilung: <strong>{abteilung}</strong>
            </p>
          )}

          {filteredMitarbeiter.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm">
              Keine Mitarbeiter gefunden.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMitarbeiter.map(ma => {
                const isSelected = selectedMitarbeiterIds.has(ma.record_id);
                const baKey = typeof ma.fields.beschaeftigungsart === 'object'
                  ? ma.fields.beschaeftigungsart?.key
                  : ma.fields.beschaeftigungsart as string | undefined;
                return (
                  <button
                    key={ma.record_id}
                    type="button"
                    onClick={() => toggleMitarbeiter(ma.record_id)}
                    className={`w-full text-left rounded-xl border-2 p-3.5 transition-all flex items-center gap-3 ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40 hover:bg-muted/20'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                    }`}>
                      {isSelected && <IconCheck size={12} stroke={2.5} className="text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">
                          {`${ma.fields.vorname ?? ''} ${ma.fields.nachname ?? ''}`.trim() || '(Kein Name)'}
                        </span>
                        {baKey && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                            {beschaeftigungsartLabel(baKey)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 min-w-0">
                        {ma.fields.abteilung && <span className="truncate">{ma.fields.abteilung}</span>}
                        {ma.fields.abteilung && ma.fields.position && <span>·</span>}
                        {ma.fields.position && <span className="truncate">{ma.fields.position}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(1)} className="gap-2">
              <IconChevronLeft size={16} />
              Zurück
            </Button>
            <Button
              disabled={!step2Valid}
              onClick={() => setCurrentStep(3)}
              className="gap-2"
            >
              Weiter
              <IconChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 3: Vorschau & Erstellen */}
      {/* ============================================================ */}
      {currentStep === 3 && (
        <div className="space-y-5">
          {/* Summary banner */}
          <div className="rounded-xl bg-muted/50 border p-4 space-y-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div className="text-muted-foreground">Zeitraum</div>
              <div className="font-medium truncate">
                {startdatum === enddatum
                  ? startdatum
                  : `${startdatum} – ${enddatum}`}
              </div>
              <div className="text-muted-foreground">Schicht</div>
              <div className="font-medium truncate">
                {selectedSchicht?.fields.schichtname ?? '—'}
                {selectedSchicht?.fields.beginn && selectedSchicht.fields.ende
                  ? ` (${selectedSchicht.fields.beginn}–${selectedSchicht.fields.ende})`
                  : ''}
              </div>
              {abteilung && (
                <>
                  <div className="text-muted-foreground">Abteilung</div>
                  <div className="font-medium truncate">{abteilung}</div>
                </>
              )}
              {standort && (
                <>
                  <div className="text-muted-foreground">Standort</div>
                  <div className="font-medium truncate">{standort}</div>
                </>
              )}
            </div>
          </div>

          {/* Entry count */}
          <div className="rounded-xl border-2 border-primary/30 bg-primary/5 px-4 py-3 flex items-center gap-2">
            <IconCalendar size={18} className="text-primary shrink-0" />
            <span className="text-sm font-semibold">
              Es werden <span className="text-primary">{totalEntries}</span> Einträge erstellt
            </span>
            <span className="text-xs text-muted-foreground ml-1">
              ({selectedMitarbeiterIds.size} Mitarbeiter × {daysInRange.length} {daysInRange.length === 1 ? 'Tag' : 'Tage'})
            </span>
          </div>

          {/* Employee preview table */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Ausgewählte Mitarbeiter</p>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm min-w-0">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left p-3 font-medium text-muted-foreground">Mitarbeiter</th>
                    <th className="text-left p-3 font-medium text-muted-foreground hidden sm:table-cell">Abteilung</th>
                    <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell">Einträge</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedMitarbeiterList.map((ma, idx) => (
                    <tr key={ma.record_id} className={idx % 2 === 0 ? '' : 'bg-muted/20'}>
                      <td className="p-3 font-medium truncate max-w-[180px]">
                        {`${ma.fields.vorname ?? ''} ${ma.fields.nachname ?? ''}`.trim() || '(Kein Name)'}
                      </td>
                      <td className="p-3 text-muted-foreground hidden sm:table-cell truncate">
                        {ma.fields.abteilung ?? '—'}
                      </td>
                      <td className="p-3 text-muted-foreground hidden md:table-cell">
                        {daysInRange.length} {daysInRange.length === 1 ? 'Eintrag' : 'Einträge'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Progress bar during creation */}
          {creating && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <IconLoader2 size={15} className="animate-spin" />
                  Einträge werden erstellt...
                </span>
                <span className="font-medium">{createdCount} von {totalToCreate}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: totalToCreate > 0 ? `${(createdCount / totalToCreate) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )}

          {creationError && (
            <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              Fehler beim Erstellen: {creationError}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(2)} disabled={creating} className="gap-2">
              <IconChevronLeft size={16} />
              Zurück
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !step1Valid || !step2Valid}
              className="gap-2"
            >
              {creating ? (
                <>
                  <IconLoader2 size={16} className="animate-spin" />
                  Wird erstellt...
                </>
              ) : (
                <>
                  <IconCheck size={16} />
                  Jetzt erstellen
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 4: Zusammenfassung */}
      {/* ============================================================ */}
      {currentStep === 4 && (
        <div className="space-y-6">
          {/* Success header */}
          <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <IconCircleCheck size={28} className="text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">
                {createdCount} {createdCount === 1 ? 'Schichteintrag wurde' : 'Schichteinträge wurden'} erfolgreich erstellt!
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Schicht: {selectedSchicht?.fields.schichtname ?? '—'}
                {selectedSchicht?.fields.beginn && selectedSchicht.fields.ende
                  ? ` · ${selectedSchicht.fields.beginn}–${selectedSchicht.fields.ende}`
                  : ''}
              </p>
            </div>
          </div>

          {/* Grouped summary */}
          {createdEntries.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Erstellte Einträge nach Mitarbeiter</p>
              <div className="space-y-2">
                {createdEntries.map(entry => (
                  <div key={entry.mitarbeiterId} className="rounded-xl border overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                      <span className="font-medium text-sm truncate">{entry.mitarbeiterName || '(Kein Name)'}</span>
                      <StatusBadge statusKey="geplant" label="Geplant" />
                    </div>
                    <div className="px-4 py-2 flex flex-wrap gap-1.5">
                      {entry.tage.map(tag => (
                        <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              onClick={handleReset}
              className="gap-2 flex-1"
            >
              <IconRefresh size={16} />
              Neue Planung erstellen
            </Button>
            <Button
              asChild
              className="flex-1"
            >
              <a href="#/schichtplanung" className="flex items-center justify-center gap-2">
                <IconCalendar size={16} />
                Zur Schichtplanung
              </a>
            </Button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <SchichttypenDialog
        open={schichttypenDialogOpen}
        onClose={() => setSchichttypenDialogOpen(false)}
        onSubmit={async (fields) => {
          await LivingAppsService.createSchichttypenEntry(fields);
          await fetchAll();
        }}
      />

      <MitarbeiterDialog
        open={mitarbeiterDialogOpen}
        onClose={() => setMitarbeiterDialogOpen(false)}
        onSubmit={async (fields) => {
          await LivingAppsService.createMitarbeiterEntry(fields);
          await fetchAll();
        }}
      />
    </IntentWizardShell>
  );
}
