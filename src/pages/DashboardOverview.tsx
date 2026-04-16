import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichSchichtplanung } from '@/lib/enrich';
import type { EnrichedSchichtplanung } from '@/types/enriched';
import type { Schichtplanung } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { useState, useMemo, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { IconAlertCircle, IconTool, IconRefresh, IconCheck, IconChevronLeft, IconChevronRight, IconPlus, IconPencil, IconTrash, IconUsers, IconCalendarPlus, IconListCheck } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SchichtplanungDialog } from '@/components/dialogs/SchichtplanungDialog';
import { AI_PHOTO_SCAN } from '@/config/ai-features';
import { addDays, startOfWeek, format, isToday } from 'date-fns';
import { de } from 'date-fns/locale';

const APPGROUP_ID = '69e097e29c379f3fd11ce273';
const REPAIR_ENDPOINT = '/claude/build/repair';

// Color map for Schichtfarbe
const SHIFT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  gruen:  { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  gelb:   { bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-300' },
  blau:   { bg: 'bg-blue-100',    text: 'text-blue-800',    border: 'border-blue-300' },
  grau:   { bg: 'bg-slate-100',   text: 'text-slate-700',   border: 'border-slate-300' },
  rot:    { bg: 'bg-rose-100',    text: 'text-rose-800',    border: 'border-rose-300' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  geplant:    { bg: 'bg-slate-100',   text: 'text-slate-600' },
  bestaetigt: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  abwesend:   { bg: 'bg-rose-100',    text: 'text-rose-700' },
  vertreter:  { bg: 'bg-purple-100',  text: 'text-purple-700' },
};

export default function DashboardOverview() {
  const {
    mitarbeiter, schichttypen, schichtplanung,
    mitarbeiterMap, schichttypenMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const enrichedSchichtplanung = enrichSchichtplanung(schichtplanung, { mitarbeiterMap, schichttypenMap });

  // Week navigation
  const [weekOffset, setWeekOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<EnrichedSchichtplanung | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnrichedSchichtplanung | null>(null);
  const [prefillDate, setPrefillDate] = useState<string | undefined>(undefined);
  const [prefillMitarbeiter, setPrefillMitarbeiter] = useState<string | undefined>(undefined);
  const [selectedMitarbeiter, setSelectedMitarbeiter] = useState<string>('all');

  // Week days (Mon–Sun)
  const weekDays = useMemo(() => {
    const today = new Date();
    const mon = startOfWeek(addDays(today, weekOffset * 7), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  }, [weekOffset]);

  const weekLabel = useMemo(() => {
    const start = weekDays[0];
    const end = weekDays[6];
    if (start.getMonth() === end.getMonth()) {
      return `${format(start, 'd.', { locale: de })} – ${format(end, 'd. MMMM yyyy', { locale: de })}`;
    }
    return `${format(start, 'd. MMM', { locale: de })} – ${format(end, 'd. MMM yyyy', { locale: de })}`;
  }, [weekDays]);

  // Shifts indexed by date string → array
  const shiftsByDate = useMemo(() => {
    const map = new Map<string, EnrichedSchichtplanung[]>();
    enrichedSchichtplanung.forEach(s => {
      if (!s.fields.datum) return;
      const key = s.fields.datum.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [enrichedSchichtplanung]);

  // Filtered mitarbeiter list
  const filteredMitarbeiter = useMemo(() => {
    if (selectedMitarbeiter !== 'all') return mitarbeiter.filter(m => m.record_id === selectedMitarbeiter);
    return mitarbeiter;
  }, [mitarbeiter, selectedMitarbeiter]);

  // Get shift for a specific date + mitarbeiter
  const getShiftsForCell = useCallback((dateStr: string, mitarbeiterId: string): EnrichedSchichtplanung[] => {
    return (shiftsByDate.get(dateStr) ?? []).filter(s => {
      const id = extractRecordId(s.fields.mitarbeiter_auswahl);
      return id === mitarbeiterId;
    });
  }, [shiftsByDate]);

  // Stats
  const confirmedCount = enrichedSchichtplanung.filter(s => s.fields.status?.key === 'bestaetigt').length;
  const absentCount = enrichedSchichtplanung.filter(s => s.fields.status?.key === 'abwesend').length;

  const handleOpenCreate = (date?: string, mitarbeiterId?: string) => {
    setEditRecord(null);
    setPrefillDate(date);
    setPrefillMitarbeiter(mitarbeiterId ? createRecordUrl(APP_IDS.MITARBEITER, mitarbeiterId) : undefined);
    setDialogOpen(true);
  };

  const handleOpenEdit = (record: EnrichedSchichtplanung) => {
    setEditRecord(record);
    setPrefillDate(undefined);
    setPrefillMitarbeiter(undefined);
    setDialogOpen(true);
  };

  const handleCreate = async (fields: Schichtplanung['fields']) => {
    await LivingAppsService.createSchichtplanungEntry(fields);
    fetchAll();
  };

  const handleUpdate = async (fields: Schichtplanung['fields']) => {
    if (!editRecord) return;
    await LivingAppsService.updateSchichtplanungEntry(editRecord.record_id, fields);
    fetchAll();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await LivingAppsService.deleteSchichtplanungEntry(deleteTarget.record_id);
    setDeleteTarget(null);
    fetchAll();
  };

  // Build defaultValues for dialog
  const dialogDefaultValues = useMemo(() => {
    if (editRecord) return editRecord.fields;
    const vals: Partial<Schichtplanung['fields']> = {};
    if (prefillDate) vals.datum = prefillDate;
    if (prefillMitarbeiter) vals.mitarbeiter_auswahl = prefillMitarbeiter;
    return Object.keys(vals).length > 0 ? vals : undefined;
  }, [editRecord, prefillDate, prefillMitarbeiter]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  return (
    <div className="space-y-5 pb-8">
      {/* Workflow intent cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <a
          href="#/intents/schichtplanung-erstellen"
          className="bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4 border-l-4 border-l-primary overflow-hidden"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <IconCalendarPlus size={20} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground truncate">Schichtplanung anlegen</p>
            <p className="text-sm text-muted-foreground line-clamp-2">Mehrere Mitarbeiter für einen Zeitraum in einem Schritt einplanen</p>
          </div>
          <IconChevronRight size={18} className="text-muted-foreground shrink-0" />
        </a>
        <a
          href="#/intents/wochenplanung"
          className="bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4 border-l-4 border-l-primary overflow-hidden"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <IconListCheck size={20} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground truncate">Wochenplanung verwalten</p>
            <p className="text-sm text-muted-foreground line-clamp-2">Schichtstatus für eine Woche prüfen und in einem Schritt bestätigen oder absagen</p>
          </div>
          <IconChevronRight size={18} className="text-muted-foreground shrink-0" />
        </a>
      </div>

      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Schichtplan</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Mitarbeiter filter */}
          <select
            className="h-9 text-sm border border-border rounded-lg px-3 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            value={selectedMitarbeiter}
            onChange={e => setSelectedMitarbeiter(e.target.value)}
          >
            <option value="all">Alle Mitarbeiter</option>
            {mitarbeiter.map(m => (
              <option key={m.record_id} value={m.record_id}>
                {m.fields.vorname} {m.fields.nachname}
              </option>
            ))}
          </select>
          {/* Week navigation */}
          <div className="flex items-center gap-1 border border-border rounded-lg overflow-hidden">
            <button
              className="h-9 w-9 flex items-center justify-center hover:bg-accent transition-colors"
              onClick={() => setWeekOffset(w => w - 1)}
              aria-label="Vorherige Woche"
            >
              <IconChevronLeft size={16} />
            </button>
            <button
              className="h-9 px-3 text-sm font-medium hover:bg-accent transition-colors"
              onClick={() => setWeekOffset(0)}
            >
              Heute
            </button>
            <button
              className="h-9 w-9 flex items-center justify-center hover:bg-accent transition-colors"
              onClick={() => setWeekOffset(w => w + 1)}
              aria-label="Nächste Woche"
            >
              <IconChevronRight size={16} />
            </button>
          </div>
          <Button size="sm" onClick={() => handleOpenCreate()}>
            <IconPlus size={14} className="mr-1 shrink-0" />
            Schicht hinzufügen
          </Button>
        </div>
      </div>

      {/* Weekly calendar grid */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-8 border-b border-border bg-muted/40">
          <div className="px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-r border-border">
            Mitarbeiter
          </div>
          {weekDays.map(day => (
            <div
              key={day.toISOString()}
              className={`px-2 py-2.5 text-center border-r border-border last:border-r-0 ${isToday(day) ? 'bg-primary/5' : ''}`}
            >
              <div className="text-xs font-semibold text-muted-foreground uppercase">
                {format(day, 'EEE', { locale: de })}
              </div>
              <div className={`text-sm font-bold mt-0.5 ${isToday(day) ? 'text-primary' : 'text-foreground'}`}>
                {format(day, 'd', { locale: de })}
              </div>
            </div>
          ))}
        </div>

        {/* Rows per mitarbeiter */}
        {filteredMitarbeiter.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <IconUsers size={40} className="text-muted-foreground" stroke={1.5} />
            <p className="text-sm text-muted-foreground">Keine Mitarbeiter vorhanden.</p>
            <Button size="sm" variant="outline" onClick={() => handleOpenCreate()}>
              <IconPlus size={14} className="mr-1" />Schicht erstellen
            </Button>
          </div>
        ) : (
          filteredMitarbeiter.map((ma, rowIdx) => (
            <div
              key={ma.record_id}
              className={`grid grid-cols-8 border-b border-border last:border-b-0 ${rowIdx % 2 === 1 ? 'bg-muted/20' : ''}`}
            >
              {/* Mitarbeiter name cell */}
              <div className="px-3 py-2 border-r border-border flex flex-col justify-center min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {ma.fields.vorname} {ma.fields.nachname}
                </p>
                {ma.fields.position && (
                  <p className="text-xs text-muted-foreground truncate">{ma.fields.position}</p>
                )}
                {ma.fields.abteilung && (
                  <p className="text-xs text-muted-foreground truncate">{ma.fields.abteilung}</p>
                )}
              </div>

              {/* Day cells */}
              {weekDays.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const shifts = getShiftsForCell(dateStr, ma.record_id);
                return (
                  <div
                    key={dateStr}
                    className={`min-h-[72px] p-1.5 border-r border-border last:border-r-0 group cursor-pointer transition-colors hover:bg-accent/30 ${isToday(day) ? 'bg-primary/3' : ''}`}
                    onClick={() => shifts.length === 0 && handleOpenCreate(dateStr, ma.record_id)}
                  >
                    {shifts.length === 0 ? (
                      <div className="h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <IconPlus size={14} className="text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {shifts.map(shift => {
                          const schichtId = extractRecordId(shift.fields.schicht_auswahl);
                          const schichttyp = schichtId ? schichttypenMap.get(schichtId) : undefined;
                          const farbeKey = schichttyp?.fields.schichtfarbe?.key ?? 'grau';
                          const colors = SHIFT_COLORS[farbeKey] ?? SHIFT_COLORS.grau;
                          const statusKey = shift.fields.status?.key ?? 'geplant';
                          const statusColors = STATUS_COLORS[statusKey] ?? STATUS_COLORS.geplant;

                          return (
                            <div
                              key={shift.record_id}
                              className={`rounded-lg border px-1.5 py-1 ${colors.bg} ${colors.border} relative`}
                              onClick={e => { e.stopPropagation(); handleOpenEdit(shift); }}
                            >
                              <div className="flex items-start justify-between gap-1 min-w-0">
                                <div className="min-w-0 flex-1">
                                  <p className={`text-xs font-bold truncate ${colors.text}`}>
                                    {shift.schicht_auswahlName || schichttyp?.fields.kuerzel || '—'}
                                  </p>
                                  {schichttyp?.fields.beginn && schichttyp.fields.ende && (
                                    <p className={`text-[10px] truncate ${colors.text} opacity-80`}>
                                      {schichttyp.fields.beginn}–{schichttyp.fields.ende}
                                    </p>
                                  )}
                                  <span className={`inline-block text-[10px] px-1 rounded mt-0.5 ${statusColors.bg} ${statusColors.text}`}>
                                    {shift.fields.status?.label ?? 'Geplant'}
                                  </span>
                                </div>
                                <div className="flex flex-col gap-0.5 shrink-0">
                                  <button
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={e => { e.stopPropagation(); handleOpenEdit(shift); }}
                                    title="Bearbeiten"
                                  >
                                    <IconPencil size={11} />
                                  </button>
                                  <button
                                    className="text-muted-foreground hover:text-destructive transition-colors"
                                    onClick={e => { e.stopPropagation(); setDeleteTarget(shift); }}
                                    title="Löschen"
                                  >
                                    <IconTrash size={11} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {/* Add more shifts to same cell */}
                        <button
                          className="w-full flex items-center justify-center h-5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={e => { e.stopPropagation(); handleOpenCreate(dateStr, ma.record_id); }}
                          title="Weitere Schicht hinzufügen"
                        >
                          <IconPlus size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 items-center">
        <span className="text-xs text-muted-foreground font-medium">Legende:</span>
        {Object.entries(SHIFT_COLORS).map(([key, c]) => {
          const label = {
            gruen: 'Frühschicht', gelb: 'Spätschicht', blau: 'Nachtschicht', grau: 'Sonstige', rot: 'Sonderfall'
          }[key] ?? key;
          return (
            <span key={key} className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border}`}>
              {label}
            </span>
          );
        })}
        <span className="text-xs text-muted-foreground ml-2 font-medium">Status:</span>
        {Object.entries(STATUS_COLORS).map(([key, c]) => {
          const label = { geplant: 'Geplant', bestaetigt: 'Bestätigt', abwesend: 'Abwesend', vertreter: 'Vertreter' }[key] ?? key;
          return (
            <span key={key} className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
              {label}
            </span>
          );
        })}
        <span className="ml-auto text-xs text-muted-foreground">{confirmedCount} bestätigt · {absentCount} abwesend</span>
      </div>

      {/* Mitarbeiter Übersicht */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center gap-2">
          <IconUsers size={16} className="text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold text-foreground">Alle Mitarbeiter</span>
          <span className="ml-auto text-xs text-muted-foreground">{mitarbeiter.length} gesamt</span>
        </div>
        {mitarbeiter.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <IconUsers size={36} className="text-muted-foreground" stroke={1.5} />
            <p className="text-sm text-muted-foreground">Keine Mitarbeiter vorhanden.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x-0">
            {mitarbeiter.map((ma, idx) => (
              <div
                key={ma.record_id}
                className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 ${idx % 2 === 1 ? 'bg-muted/20' : ''}`}
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                  {(ma.fields.vorname?.[0] ?? '').toUpperCase()}{(ma.fields.nachname?.[0] ?? '').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {ma.fields.vorname} {ma.fields.nachname}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {ma.fields.position && (
                      <span className="text-xs text-muted-foreground truncate">{ma.fields.position}</span>
                    )}
                    {ma.fields.abteilung && (
                      <span className="text-xs text-muted-foreground truncate">· {ma.fields.abteilung}</span>
                    )}
                    {ma.fields.beschaeftigungsart && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{ma.fields.beschaeftigungsart.label}</span>
                    )}
                  </div>
                </div>
                {ma.fields.telefon && (
                  <span className="text-xs text-muted-foreground shrink-0 hidden sm:block truncate max-w-[100px]">{ma.fields.telefon}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dialog */}
      <SchichtplanungDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditRecord(null); }}
        onSubmit={async (fields) => {
          if (editRecord) {
            await handleUpdate(fields);
          } else {
            await handleCreate(fields);
          }
        }}
        defaultValues={dialogDefaultValues}
        mitarbeiterList={mitarbeiter}
        schichttypenList={schichttypen}
        enablePhotoScan={AI_PHOTO_SCAN['Schichtplanung']}
      />

      {/* Confirm delete */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Schicht löschen"
        description={`Schicht von ${deleteTarget?.mitarbeiter_auswahlName || '—'} am ${deleteTarget?.fields.datum ? formatDate(deleteTarget.fields.datum) : '—'} wirklich löschen?`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

function DashboardError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const [repairing, setRepairing] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  const [repairDone, setRepairDone] = useState(false);
  const [repairFailed, setRepairFailed] = useState(false);

  const handleRepair = async () => {
    setRepairing(true);
    setRepairStatus('Reparatur wird gestartet...');
    setRepairFailed(false);

    const errorContext = JSON.stringify({
      type: 'data_loading',
      message: error.message,
      stack: (error.stack ?? '').split('\n').slice(0, 10).join('\n'),
      url: window.location.href,
    });

    try {
      const resp = await fetch(REPAIR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appgroup_id: APPGROUP_ID, error_context: errorContext }),
      });

      if (!resp.ok || !resp.body) {
        setRepairing(false);
        setRepairFailed(true);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data: ')) continue;
          const content = line.slice(6);
          if (content.startsWith('[STATUS]')) {
            setRepairStatus(content.replace(/^\[STATUS]\s*/, ''));
          }
          if (content.startsWith('[DONE]')) {
            setRepairDone(true);
            setRepairing(false);
          }
          if (content.startsWith('[ERROR]') && !content.includes('Dashboard-Links')) {
            setRepairFailed(true);
          }
        }
      }
    } catch {
      setRepairing(false);
      setRepairFailed(true);
    }
  };

  if (repairDone) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center">
          <IconCheck size={22} className="text-green-500" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold text-foreground mb-1">Dashboard repariert</h3>
          <p className="text-sm text-muted-foreground max-w-xs">Das Problem wurde behoben. Bitte laden Sie die Seite neu.</p>
        </div>
        <Button size="sm" onClick={() => window.location.reload()}>
          <IconRefresh size={14} className="mr-1" />Neu laden
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
        <IconAlertCircle size={22} className="text-destructive" />
      </div>
      <div className="text-center">
        <h3 className="font-semibold text-foreground mb-1">Fehler beim Laden</h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          {repairing ? repairStatus : error.message}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onRetry} disabled={repairing}>Erneut versuchen</Button>
        <Button size="sm" onClick={handleRepair} disabled={repairing}>
          {repairing
            ? <span className="inline-block w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-1" />
            : <IconTool size={14} className="mr-1" />}
          {repairing ? 'Reparatur läuft...' : 'Dashboard reparieren'}
        </Button>
      </div>
      {repairFailed && <p className="text-sm text-destructive">Automatische Reparatur fehlgeschlagen. Bitte kontaktieren Sie den Support.</p>}
    </div>
  );
}
