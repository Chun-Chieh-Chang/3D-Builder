/**
 * Autosave and crash recovery (B9.3). While a part has changes that are not in its file, a copy of it is kept in the browser a few seconds after the last
 * change; saving, or putting the changes away on purpose, throws the copy away. After a crash or a closed tab the copy is still there, and the next start
 * offers it. This file holds the timing and the rules; where the copy is kept (`RecoveryBox`) and how a part is turned into bytes (`snapshot`) are given.
 */

/** What is kept: the part file's bytes, and what the user would recognise it by. */
export interface Recovery {
  bytes: Uint8Array;
  /** The name of the file it came from, or null for a part never saved. */
  fileName: string | null;
  /** The name an unsaved part is shown under (「零件1」). */
  untitled: string;
  savedAt: number;
}

/** A place that keeps one copy. */
export interface RecoveryBox {
  put(entry: Recovery): Promise<void>;
  get(): Promise<Recovery | null>;
  clear(): Promise<void>;
}

export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  /** A write that has been started: a clear has to wait for it, or the copy it makes would outlive the clear. */
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly box: RecoveryBox,
    /** The part as it is now, or null when there is nothing to keep. */
    private readonly snapshot: () => Promise<Omit<Recovery, 'savedAt'> | null>,
    private readonly delayMs = 5000,
    private readonly now: () => number = Date.now,
  ) {}

  /** The part changed: `dirty` says whether it now differs from its file. Keeps a copy soon, or throws the copy away when the change brought it back. */
  changed(dirty: boolean): void {
    if (!dirty) return void this.clear();
    this.pending = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Keeps the copy now if there is a change waiting (the page is going away). */
  flush(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return this.writing;
    this.pending = false;
    this.writing = this.writing.then(async () => {
      try {
        const s = await this.snapshot();
        if (s) await this.box.put({ ...s, savedAt: this.now() });
      } catch {
        // a copy that could not be made is not worth stopping the work for; the next change tries again
      }
    });
    return this.writing;
  }

  /** The part is saved, or put away: no copy is wanted any more. */
  clear(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
    this.writing = this.writing.then(() => this.box.clear().catch(() => {}));
    return this.writing;
  }
}
