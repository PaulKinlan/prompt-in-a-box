/**
 * Artifacts — user-facing outputs that agents produce.
 *
 * A prompt may write lots of things to OPFS (cursors, dedup keys, event
 * logs) that are pure internal state. Artifacts are the subset meant
 * for the human: summaries, digests, quotes, screenshots, journal
 * entries, meeting notes. This module is the canonical place for
 * those, so the popup and the artifacts browser can surface them
 * without the prompt having to know about either.
 *
 * Storage layout:
 *   - content bytes/text → OPFS at `artifacts/YYYY-MM-DD/<slug>-<id>.<ext>`
 *   - metadata index → chrome.storage.local under `__pib_artifact_index`
 *     (newest first, capped at MAX_INDEX)
 *
 * Each entry in the index is a thin summary; the popup reads the index
 * directly. The artifacts browser follows `path` into OPFS to show the
 * full content on click.
 *
 * Kept separate from audit.ts because audit is about runs (what the
 * agent did); artifacts is about outputs (what the agent produced).
 * A single run may emit zero, one, or many artifacts.
 */

import { opfs } from './storage/opfs';

export const ARTIFACT_DIR = 'artifacts';
const INDEX_KEY = '__pib_artifact_index';
const MAX_INDEX = 2000;

export type ArtifactKind =
  | 'markdown'
  | 'html'
  | 'json'
  | 'text'
  | 'image-png'
  | 'image-jpeg';

export interface ArtifactIndexEntry {
  artifactId: string;
  createdAt: number;
  kind: ArtifactKind;
  title: string;
  path: string;
  /** One-line summary / excerpt for list views. */
  preview?: string;
  tags?: string[];
  sourceUrl?: string;
  /** Set automatically: which audit run produced this artifact (if known). */
  runId?: string;
  /** Bytes on disk for binary artifacts, chars for text. */
  size: number;
}

export interface Artifact extends ArtifactIndexEntry {
  /** Text content for text kinds; base64 for image kinds. */
  content: string;
}

const EXT_BY_KIND: Record<ArtifactKind, string> = {
  markdown: 'md',
  html: 'html',
  json: 'json',
  text: 'txt',
  'image-png': 'png',
  'image-jpeg': 'jpg',
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'untitled';
}

export function newArtifactId(): string {
  const t = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 0x100000).toString(16).padStart(5, '0');
  return `${t}-${rnd}`;
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export interface CreateArtifactInput {
  kind: ArtifactKind;
  title: string;
  /** Text for text kinds; base64 (no data: prefix) for image kinds. */
  content: string;
  tags?: string[];
  sourceUrl?: string;
  runId?: string;
}

/**
 * Write an artifact to OPFS and append a row to the index.
 */
export async function createArtifact(
  input: CreateArtifactInput,
): Promise<ArtifactIndexEntry> {
  const createdAt = Date.now();
  const artifactId = newArtifactId();
  const slug = slugify(input.title);
  const ext = EXT_BY_KIND[input.kind];
  const path = `${ARTIFACT_DIR}/${isoDate(createdAt)}/${slug}-${artifactId}.${ext}`;

  let size: number;
  if (input.kind === 'image-png' || input.kind === 'image-jpeg') {
    const bytes = base64ToBytes(input.content);
    await opfs.writeBytes(path, bytes);
    size = bytes.length;
  } else {
    await opfs.writeText(path, input.content);
    size = input.content.length;
  }

  const preview = input.kind.startsWith('image-')
    ? undefined
    : input.content.replace(/\s+/g, ' ').trim().slice(0, 200);

  const entry: ArtifactIndexEntry = {
    artifactId,
    createdAt,
    kind: input.kind,
    title: input.title,
    path,
    preview,
    tags: input.tags,
    sourceUrl: input.sourceUrl,
    runId: input.runId,
    size,
  };

  const { [INDEX_KEY]: existing = [] } = await chrome.storage.local.get(INDEX_KEY);
  const next = [entry, ...(existing as ArtifactIndexEntry[])].slice(0, MAX_INDEX);
  await chrome.storage.local.set({ [INDEX_KEY]: next });

  return entry;
}

export async function listArtifacts(): Promise<ArtifactIndexEntry[]> {
  const { [INDEX_KEY]: stored = [] } = await chrome.storage.local.get(INDEX_KEY);
  return stored as ArtifactIndexEntry[];
}

export async function getArtifact(artifactId: string): Promise<Artifact | null> {
  const index = await listArtifacts();
  const entry = index.find((e) => e.artifactId === artifactId);
  if (!entry) return null;
  try {
    if (entry.kind === 'image-png' || entry.kind === 'image-jpeg') {
      const bytes = await opfs.readBytes(entry.path);
      return { ...entry, content: bytesToBase64(bytes) };
    }
    const text = await opfs.readText(entry.path);
    return { ...entry, content: text };
  } catch {
    return null;
  }
}

export async function deleteArtifact(artifactId: string): Promise<void> {
  const index = await listArtifacts();
  const entry = index.find((e) => e.artifactId === artifactId);
  if (!entry) return;
  try {
    await opfs.remove(entry.path);
  } catch {
    // File may have been deleted already; keep pruning the index.
  }
  const next = index.filter((e) => e.artifactId !== artifactId);
  await chrome.storage.local.set({ [INDEX_KEY]: next });
}

export async function clearArtifacts(): Promise<void> {
  await chrome.storage.local.set({ [INDEX_KEY]: [] });
  try {
    const entries = await opfs.list(ARTIFACT_DIR);
    for (const e of entries) {
      if (e.kind === 'directory') {
        await opfs.remove(`${ARTIFACT_DIR}/${e.name}`, true);
      } else {
        await opfs.remove(`${ARTIFACT_DIR}/${e.name}`);
      }
    }
  } catch {
    // Directory may not exist yet.
  }
}

// Tiny base64 helpers — no Buffer, works in SW + offscreen + options page.
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
