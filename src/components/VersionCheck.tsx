import { useState, useEffect, useCallback, Fragment } from 'react';
import { IconRefresh, IconHistory, IconLoader, IconChevronDown, IconCheck, IconClock, IconArrowBackUp, IconSparkles, IconMessageCircle, IconGitBranch, IconArrowLeft } from '@tabler/icons-react';

const APPGROUP_ID = '69e097e29c379f3fd11ce273';
const UPDATE_ENDPOINT = '/claude/build/update';
const DEPLOYMENTS_ENDPOINT = `/claude/build/deployments/${APPGROUP_ID}`;
const ROLLBACK_ENDPOINT = '/claude/build/rollback';
const VERSION_ENDPOINT = '/claude/version';

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function formatTimestamp(ts: string): string {
  // "20260411_070729" → "11.04.2026, 07:07"
  if (ts.length < 15) return ts;
  const y = ts.slice(0, 4), m = ts.slice(4, 6), d = ts.slice(6, 8);
  const h = ts.slice(9, 11), min = ts.slice(11, 13);
  return `${d}.${m}.${y}, ${h}:${min}`;
}

function formatDeployedAt(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso.slice(0, 16); }
}

interface Deployment {
  sha: string;       // git SHA (empty string for some legacy attic entries)
  branch: string;    // git branch name ("main" or "branch-{TS}")
  source: string;    // initial | update | agent
  version: string;   // service version at deploy time (e.g. "0.0.102")
  deployed_at: string;  // ISO datetime
  is_live: boolean;
  timestamp?: string;  // legacy attic timestamp (only present for attic-source deployments)
}

type Status = 'idle' | 'loading' | 'updating' | 'rolling_back' | 'error';

function rollbackId(d: Deployment): string {
  // Prefer sha; fall back to legacy timestamp for attic-only deployments
  return d.sha || d.timestamp || '';
}

function deploymentMeta(source: string | undefined): { icon: typeof IconArrowBackUp; colorClass: string; bgClass: string; label: string } {
  switch (source) {
    case 'initial':
      return { icon: IconSparkles, colorClass: 'text-blue-500', bgClass: 'bg-blue-500/5', label: 'Erstversion' };
    case 'update':
      return { icon: IconRefresh, colorClass: 'text-emerald-500', bgClass: 'bg-emerald-500/5', label: 'Scaffold-Update' };
    case 'agent':
      return { icon: IconMessageCircle, colorClass: 'text-violet-500', bgClass: 'bg-violet-500/5', label: 'KI-Änderung' };
    default:
      return { icon: IconArrowBackUp, colorClass: 'text-muted-foreground', bgClass: '', label: '' };
  }
}

export function VersionCheck() {
  const [status, setStatus] = useState<Status>('loading');
  const [deployedVersion, setDeployedVersion] = useState('');
  const [deployedCommit, setDeployedCommit] = useState('');
  const [deployedAt, setDeployedAt] = useState('');
  const [latestVersion, setLatestVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loadingDeployments, setLoadingDeployments] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [deployedRes, serviceRes] = await Promise.all([
          fetch('./version.json', { cache: 'no-store' }),
          fetch(VERSION_ENDPOINT, { credentials: 'include' }),
        ]);
        if (cancelled) return;
        if (!deployedRes.ok || !serviceRes.ok) { setStatus('idle'); return; }
        const deployed = await deployedRes.json();
        const service = await serviceRes.json();
        setDeployedVersion(deployed.version || '');
        setDeployedCommit(deployed.commit || '');
        setDeployedAt(deployed.deployed_at || '');
        setLatestVersion(service.version || '');
        setUpdateAvailable(
          !!(deployed.version && service.version && compareSemver(service.version, deployed.version) > 0)
        );
        setStatus('idle');
      } catch { setStatus('idle'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadDeployments = useCallback(async () => {
    if (deployments.length > 0) return;
    setLoadingDeployments(true);
    try {
      const res = await fetch(DEPLOYMENTS_ENDPOINT, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDeployments(data.deployments || []);
      }
    } catch { /* ignore */ }
    setLoadingDeployments(false);
  }, [deployments.length]);

  const handleUpdate = useCallback(async () => {
    if (!window.confirm('Anwendung auf neuste Version aktualisieren?')) return;
    setStatus('updating');
    setShowPanel(false);
    try {
      const resp = await fetch(UPDATE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appgroup_id: APPGROUP_ID, fix_errors: true }),
      });
      if (!resp.ok || !resp.body) { setStatus('error'); return; }
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
          if (content.startsWith('[DONE]')) { window.location.reload(); return; }
          if (content.startsWith('[ERROR]')) { setStatus('error'); return; }
        }
      }
      window.location.reload();
    } catch { setStatus('error'); }
  }, []);

  const handleRollback = useCallback(async (deployment: Deployment) => {
    if (!window.confirm('Anwendung auf letzte Version zurücksetzen?')) return;
    const rid = rollbackId(deployment);
    setRollbackTarget(rid);
    setStatus('rolling_back');
    try {
      // Prefer sha-based rollback (new, pointer-only); fall back to timestamp
      // for legacy attic-only deployments.
      const body: Record<string, string> = { appgroup_id: APPGROUP_ID };
      if (deployment.sha) body.sha = deployment.sha;
      else if (deployment.timestamp) body.timestamp = deployment.timestamp;
      else { setStatus('error'); setRollbackTarget(null); return; }

      const resp = await fetch(ROLLBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!resp.ok) { setStatus('error'); setRollbackTarget(null); return; }
      window.location.reload();
    } catch { setStatus('error'); setRollbackTarget(null); }
  }, []);

  if (status === 'loading') return null;

  if (status === 'updating') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
        <IconRefresh size={14} className="shrink-0 animate-spin" />
        <span>Aktualisiert…</span>
      </div>
    );
  }

  if (status === 'rolling_back') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
        <IconHistory size={14} className="shrink-0 animate-spin" />
        <span>Wird zurückgesetzt…</span>
      </div>
    );
  }

  return (
    <div>
      {/* Version button — toggles panel */}
      <button
        onClick={() => {
          const next = !showPanel;
          setShowPanel(next);
          if (next) loadDeployments();
        }}
        className="flex items-center justify-between gap-2 w-full px-4 py-2 text-left text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-sidebar-accent/30"
      >
        <span className="flex items-center gap-1.5">
          <IconClock size={13} className="shrink-0" />
          {deployedVersion ? `v${deployedVersion}` : '—'}
          {deployedCommit && <span className="text-muted-foreground/50">({deployedCommit})</span>}
        </span>
        <IconChevronDown size={13} className={`shrink-0 transition-transform ${showPanel ? 'rotate-180' : ''}`} />
      </button>

      {/* Update banner */}
      {updateAvailable && !showPanel && (
        <button
          onClick={handleUpdate}
          className="flex items-center gap-2 mx-3 mt-1 px-3 py-1.5 w-[calc(100%-1.5rem)] rounded-lg text-xs font-medium text-[#2563eb] bg-secondary border border-[#bfdbfe] hover:bg-[#dbeafe] transition-colors"
        >
          <IconRefresh size={13} className="shrink-0" />
          <span>Update verfügbar: v{latestVersion}</span>
        </button>
      )}

      {/* Versions panel */}
      {showPanel && (() => {
        // Group deployments by branch
        const grouped = new Map<string, Deployment[]>();
        for (const d of deployments) {
          const key = d.branch || 'main';
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(d);
        }
        const liveDep = deployments.find(d => d.is_live);
        const liveBranch = liveDep?.branch || 'main';
        const mainDeps = grouped.get('main') || [];
        const altKeys = [...grouped.keys()].filter(k => k !== 'main')
          .sort((a, b) => {
            const at = grouped.get(a)![0]?.deployed_at || '';
            const bt = grouped.get(b)![0]?.deployed_at || '';
            return bt.localeCompare(at);
          });
        const branchEntries = selectedBranch ? (grouped.get(selectedBranch) || []) : [];

        return (
        <div className="mx-3 mt-1 mb-2 rounded-xl border border-sidebar-border bg-sidebar overflow-hidden">
          {/* Update button at top */}
          {updateAvailable && !selectedBranch && (
            <button
              onClick={handleUpdate}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-[#2563eb] bg-secondary/50 hover:bg-secondary border-b border-sidebar-border transition-colors"
            >
              <IconRefresh size={13} className="shrink-0" />
              <span>Update verfügbar: v{latestVersion}</span>
            </button>
          )}

          {loadingDeployments ? (
            <div className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <IconLoader size={13} className="animate-spin" />
              <span>Lade Versionen...</span>
            </div>
          ) : deployments.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              Keine früheren Versionen
            </div>

          /* ── Ebene 2: Version list for selected branch ── */
          ) : selectedBranch ? (
            <div className="max-h-72 overflow-y-auto">
              {/* Back button */}
              <button
                onClick={() => setSelectedBranch(null)}
                className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground border-b border-sidebar-border transition-colors"
              >
                <IconArrowLeft size={13} className="shrink-0" />
                {selectedBranch === 'main' ? 'Hauptlinie' : 'Alternative Richtung'}
              </button>

              {/* Version entries */}
              {branchEntries.map((dep) => {
                const meta = deploymentMeta(dep.source);
                const Icon = meta.icon;
                const rid = rollbackId(dep);
                const displayTime = dep.deployed_at
                  ? formatDeployedAt(dep.deployed_at)
                  : (dep.timestamp ? formatTimestamp(dep.timestamp) : '');
                return (
                  <button
                    key={rid || dep.deployed_at}
                    onClick={() => handleRollback(dep)}
                    disabled={dep.is_live || rollbackTarget === rid}
                    className={`group flex items-center gap-2 w-full text-left text-xs transition-colors border-b border-sidebar-border last:border-b-0 ${
                      dep.is_live
                        ? 'bg-primary/5 border-l-[3px] border-l-primary pl-2.5 pr-3 py-2.5 cursor-default'
                        : 'px-3 py-2 hover:bg-sidebar-accent/30 disabled:opacity-50'
                    }`}
                  >
                    {dep.is_live ? (
                      <IconCheck size={14} className="shrink-0 text-primary" />
                    ) : (
                      <>
                        <Icon size={14} className={`shrink-0 ${meta.colorClass} group-hover:hidden`} />
                        <IconArrowBackUp size={14} className="shrink-0 text-muted-foreground hidden group-hover:block" />
                      </>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={dep.is_live ? 'text-foreground font-semibold' : 'text-foreground font-medium'}>{displayTime}</span>
                        {dep.version && <span className="text-muted-foreground/60">v{dep.version}</span>}
                        {dep.is_live && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-semibold uppercase tracking-wider">live</span>
                        )}
                      </div>
                      {meta.label && (
                        <div className={`text-[10px] mt-0.5 ${dep.is_live ? 'text-primary/70' : meta.colorClass}`}>{meta.label}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

          /* ── Ebene 1: Branch graph overview ── */
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {/* Main branch card */}
              <button
                onClick={() => setSelectedBranch('main')}
                className="w-full px-3 py-3 text-left hover:bg-sidebar-accent/20 transition-colors border-b border-sidebar-border"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-foreground">Hauptlinie</span>
                  <div className="flex items-center gap-1.5">
                    {liveBranch === 'main' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-semibold uppercase tracking-wider">live</span>
                    )}
                    <IconChevronDown size={12} className="-rotate-90 text-muted-foreground" />
                  </div>
                </div>
                {/* Dot-line */}
                <div className="flex items-center gap-0 mb-1">
                  {Array.from({ length: Math.min(mainDeps.length, 8) }).map((_, i) => (
                    <Fragment key={i}>
                      <div className={`w-2 h-2 rounded-full shrink-0 ${liveBranch === 'main' ? 'bg-primary' : 'bg-muted-foreground'}`} />
                      {i < Math.min(mainDeps.length, 8) - 1 && (
                        <div className={`w-3 h-0.5 ${liveBranch === 'main' ? 'bg-primary/40' : 'bg-border'}`} />
                      )}
                    </Fragment>
                  ))}
                  {mainDeps.length > 8 && <span className="text-[9px] text-muted-foreground ml-1">+{mainDeps.length - 8}</span>}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {mainDeps.length} {mainDeps.length === 1 ? 'Version' : 'Versionen'}
                </span>
              </button>

              {/* Alternative branches */}
              {altKeys.length > 0 && (
                <div className="ml-4 border-l-2 border-violet-300/50">
                  {altKeys.map((branchKey, idx) => {
                    const deps = grouped.get(branchKey)!;
                    const hasLive = branchKey === liveBranch;
                    return (
                      <button
                        key={branchKey}
                        onClick={() => setSelectedBranch(branchKey)}
                        className={`w-full pl-3 pr-3 py-3 text-left hover:bg-sidebar-accent/20 transition-colors ${idx < altKeys.length - 1 ? 'border-b border-sidebar-border' : ''}`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-foreground">
                            Alternative Richtung{altKeys.length > 1 ? ` ${idx + 1}` : ''}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {hasLive && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-500 font-semibold uppercase tracking-wider">live</span>
                            )}
                            <IconChevronDown size={12} className="-rotate-90 text-muted-foreground" />
                          </div>
                        </div>
                        {/* Dot-line */}
                        <div className="flex items-center gap-0 mb-1">
                          {Array.from({ length: Math.min(deps.length, 8) }).map((_, i) => (
                            <Fragment key={i}>
                              <div className={`w-2 h-2 rounded-full shrink-0 ${hasLive ? 'bg-violet-500' : 'bg-violet-400'}`} />
                              {i < Math.min(deps.length, 8) - 1 && (
                                <div className={`w-3 h-0.5 ${hasLive ? 'bg-violet-300' : 'bg-violet-200'}`} />
                              )}
                            </Fragment>
                          ))}
                          {deps.length > 8 && <span className="text-[9px] text-muted-foreground ml-1">+{deps.length - 8}</span>}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {deps.length} {deps.length === 1 ? 'Version' : 'Versionen'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        );
      })()}

      {status === 'error' && (
        <div className="mx-3 mt-1 px-3 py-1.5 text-xs text-destructive bg-destructive/10 rounded-lg">
          Fehler aufgetreten
        </div>
      )}
    </div>
  );
}
