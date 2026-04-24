/**
 * OPFS (Origin Private File System) wrapper.
 *
 * All paths are relative to the OPFS root. Nested directories are created
 * automatically when writing files. The API is intentionally small — read,
 * write, list, delete — because the tools that expose it to the model
 * (see src/tools/opfs-*.ts) need a tight surface to describe.
 */

export class OPFS {
  private rootPromise: Promise<FileSystemDirectoryHandle> | null = null;

  private async root(): Promise<FileSystemDirectoryHandle> {
    if (!this.rootPromise) {
      this.rootPromise = navigator.storage.getDirectory();
    }
    return this.rootPromise;
  }

  static splitPath(path: string): string[] {
    return path.split('/').filter(Boolean);
  }

  private async resolveParent(
    path: string,
    create: boolean,
  ): Promise<[FileSystemDirectoryHandle, string]> {
    const segments = OPFS.splitPath(path);
    if (segments.length === 0) {
      throw new Error(`Invalid path: "${path}"`);
    }
    const fileName = segments.pop()!;
    let dir = await this.root();
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return [dir, fileName];
  }

  private async resolveDir(
    path: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    const segments = OPFS.splitPath(path);
    let dir = await this.root();
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return dir;
  }

  async readText(path: string): Promise<string> {
    const [parent, name] = await this.resolveParent(path, false);
    const fh = await parent.getFileHandle(name);
    const file = await fh.getFile();
    return await file.text();
  }

  async writeText(path: string, content: string): Promise<void> {
    const [parent, name] = await this.resolveParent(path, true);
    const fh = await parent.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const [parent, name] = await this.resolveParent(path, true);
    const fh = await parent.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    // Cast through Blob to dodge the ArrayBuffer/SharedArrayBuffer
    // variance issue in TS's lib.dom types — runtime is fine either way.
    await w.write(new Blob([bytes as unknown as BlobPart]));
    await w.close();
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const [parent, name] = await this.resolveParent(path, false);
    const fh = await parent.getFileHandle(name);
    const file = await fh.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    try {
      const [parent, name] = await this.resolveParent(path, false);
      await parent.getFileHandle(name);
      return true;
    } catch {
      try {
        await this.resolveDir(path, false);
        return true;
      } catch {
        return false;
      }
    }
  }

  async remove(path: string, recursive = false): Promise<void> {
    const [parent, name] = await this.resolveParent(path, false);
    await parent.removeEntry(name, { recursive });
  }

  async list(path: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
    const dir = await this.resolveDir(path || '', false);
    const entries: Array<{ name: string; kind: 'file' | 'directory' }> = [];
    // @ts-expect-error async iterator is supported in modern browsers
    for await (const [name, handle] of dir.entries()) {
      entries.push({ name, kind: handle.kind });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Module-level singleton. OPFS is per-origin so sharing one instance is safe. */
export const opfs = new OPFS();
