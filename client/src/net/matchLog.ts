import { summarize, type MatchLogEntry } from '@manhunt/host';

const KEY = 'manhunt.matchLog.v1';
const MAX = 500;

/** Match telemetry lives in the host's localStorage so friends can share it for tuning. */
export function readMatchLog(): MatchLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MatchLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendMatchLog(entry: unknown): void {
  try {
    const log = readMatchLog();
    log.push(entry as MatchLogEntry);
    localStorage.setItem(KEY, JSON.stringify(log.slice(-MAX)));
  } catch {
    // Storage full or blocked: telemetry is best-effort.
  }
}

export function clearMatchLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
}

/** Triggers a download of the match log (JSON with a summary). */
export function downloadMatchLog(): void {
  const entries = readMatchLog();
  const blob = new Blob([JSON.stringify({ summary: summarize(entries), entries }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `manhunt-matches-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
