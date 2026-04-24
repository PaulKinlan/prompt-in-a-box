/**
 * Event queue, persisted to OPFS.
 *
 * Events captured by the dispatcher (src/events/dispatcher.ts) land
 * here as JSONL. The background loop drains the queue at the start of
 * each run and passes the events to the agent as part of the user
 * message: "Events since last run: […]". The prompt is expected to
 * decide what (if anything) to do about them.
 *
 * Why OPFS and not chrome.storage? Events can be bursty (every tab
 * navigation, every bookmark add). OPFS gives us append-via-file +
 * drain-and-truncate semantics without the 10MB total-quota pressure
 * that chrome.storage.local sits under.
 *
 * JSONL rather than a single JSON array: appending to JSONL is just a
 * write-with-truncate-flag. Keeping an in-memory array and rewriting
 * the whole file on every event would turn high-frequency event
 * sources (webNavigation.onCompleted fires on every page load) into
 * a non-trivial disk-IO storm.
 */

export const EVENT_QUEUE_PATH = 'events/queue.jsonl';
const MAX_QUEUE_BYTES = 1024 * 1024; // 1 MB cap; oldest lines get dropped beyond this.

export interface QueuedEvent {
  at: number;
  source: string;
  triggersRun: boolean;
  payload: unknown;
}

async function getQueueFile(): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('events', { create: true });
  return await dir.getFileHandle('queue.jsonl', { create: true });
}

export async function enqueueEvent(event: QueuedEvent): Promise<void> {
  const line = JSON.stringify(event) + '\n';
  const fh = await getQueueFile();
  const file = await fh.getFile();
  const existing = await file.text();
  let next = existing + line;
  // Trim from the front if we blow the cap. Dropping the oldest events
  // is the least-bad option when the agent hasn't been running.
  if (next.length > MAX_QUEUE_BYTES) {
    const overflow = next.length - MAX_QUEUE_BYTES;
    const cutAt = next.indexOf('\n', overflow) + 1;
    next = next.slice(cutAt);
  }
  const w = await fh.createWritable();
  await w.write(next);
  await w.close();
}

export async function drainEvents(): Promise<QueuedEvent[]> {
  const fh = await getQueueFile();
  const file = await fh.getFile();
  const text = await file.text();
  if (!text) return [];
  const w = await fh.createWritable();
  await w.write('');
  await w.close();
  const events: QueuedEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as QueuedEvent);
    } catch {
      // Skip malformed lines rather than fail the whole drain.
    }
  }
  return events;
}

export async function peekEventCount(): Promise<number> {
  try {
    const fh = await getQueueFile();
    const file = await fh.getFile();
    const text = await file.text();
    if (!text) return 0;
    return text.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}
