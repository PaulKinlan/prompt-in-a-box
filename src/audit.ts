/**
 * Audit log.
 *
 * Every agent run captures:
 *   - trigger, timestamps, duration, status
 *   - provider / model
 *   - full tool-call trace (name, args, result, duration, whether blocked)
 *   - token usage (input / output / cost per step)
 *   - final text summary
 *
 * Audit entries live in OPFS under `audit/<runId>.json` so each can be
 * arbitrarily large without crowding chrome.storage.local (which has
 * a 10 MB quota per extension). The list of run IDs lives in
 * chrome.storage.local for fast pagination in the options page.
 *
 * The options page reads entries lazily via OPFS when the user expands
 * a row, so the list view stays cheap even with a few thousand runs.
 */

import { opfs } from './storage/opfs';

export const AUDIT_DIR = 'audit';
const INDEX_KEY = '__pib_audit_index';
const MAX_ENTRIES = 500;

export interface AuditToolCall {
  at: number;
  name: string;
  args: unknown;
  /** Present when the tool finished. */
  durationMs?: number;
  /** Present when the tool returned successfully or with a handled error. */
  result?: unknown;
  /** Set if a pre/post-tool hook blocked this call. */
  blocked?: boolean;
  error?: string;
}

export interface AuditEntry {
  runId: string;
  startedAt: number;
  finishedAt?: number;
  trigger: 'alarm' | 'manual' | 'onboarding-test';
  status: 'ok' | 'error' | 'skipped';
  provider: string;
  model: string;
  /** One-line summary for the list view. */
  summary: string;
  /** Full final text the model returned, if any. */
  finalText?: string;
  steps?: number;
  toolCalls: AuditToolCall[];
  /** Aggregated usage across all steps of this run. */
  tokens: {
    input: number;
    output: number;
    estimatedCost: number;
  };
  /** Set on error path. */
  error?: string;
}

export interface AuditIndexEntry {
  runId: string;
  startedAt: number;
  status: AuditEntry['status'];
  provider: string;
  model: string;
  summary: string;
  durationMs?: number;
  toolCallCount: number;
  estimatedCost: number;
}

/**
 * Append a full audit entry. Writes the detailed record to OPFS and a
 * thin summary to the chrome.storage index.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await opfs.writeText(
      `${AUDIT_DIR}/${entry.runId}.json`,
      JSON.stringify(entry, null, 2),
    );
  } catch (err) {
    // OPFS failure shouldn't hide the run from the list. Fall through
    // to updating the index anyway so the operator at least sees
    // *something* happened.
    console.warn('[audit] OPFS write failed, continuing:', err);
  }

  const summary: AuditIndexEntry = {
    runId: entry.runId,
    startedAt: entry.startedAt,
    status: entry.status,
    provider: entry.provider,
    model: entry.model,
    summary: entry.summary,
    durationMs: entry.finishedAt ? entry.finishedAt - entry.startedAt : undefined,
    toolCallCount: entry.toolCalls.length,
    estimatedCost: entry.tokens.estimatedCost,
  };

  const { [INDEX_KEY]: existing = [] } = await chrome.storage.local.get(INDEX_KEY);
  const next = [summary, ...(existing as AuditIndexEntry[])].slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ [INDEX_KEY]: next });
}

export async function getAuditIndex(): Promise<AuditIndexEntry[]> {
  const { [INDEX_KEY]: stored = [] } = await chrome.storage.local.get(INDEX_KEY);
  return stored as AuditIndexEntry[];
}

export async function getAuditEntry(runId: string): Promise<AuditEntry | null> {
  try {
    const raw = await opfs.readText(`${AUDIT_DIR}/${runId}.json`);
    return JSON.parse(raw) as AuditEntry;
  } catch {
    return null;
  }
}

export async function clearAudit(): Promise<void> {
  await chrome.storage.local.set({ [INDEX_KEY]: [] });
  try {
    const entries = await opfs.list(AUDIT_DIR);
    for (const e of entries) {
      if (e.kind === 'file' && e.name.endsWith('.json')) {
        await opfs.remove(`${AUDIT_DIR}/${e.name}`);
      }
    }
  } catch {
    // Directory may not exist yet — ignore.
  }
}

export function newRunId(): string {
  // Short, sortable, enough collision resistance for a single
  // extension instance. Timestamp + 4 hex chars.
  const t = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${t}-${rnd}`;
}
