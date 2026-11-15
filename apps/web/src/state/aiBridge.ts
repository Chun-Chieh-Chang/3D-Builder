/**
 * The app end of the live link to an AI agent's MCP server (ADR 0238, assemblies ADR 0253). The user types the connection code; the open document is
 * sent (the part, or the assembly with the content of its part files), the agent's batches come back and are applied as one undo step each, or
 * refused: when the document changed since the server saw it, while the user is in a sketch, a feature's settings or an assembly's PropertyManager,
 * or when the batch is for another kind of document than the one open. The user's own changes are sent to the server 300 ms after the last one.
 *
 * Nothing of the store here: what it needs is passed in, so that a test runs it in Node against the real server.
 */
import { LIVE_PROTOCOL, parseLiveCode, sha256Hex, toBase64, type AppMessage, type LiveBlobs, type LiveOpen, type LiveRefusal, type ServerMessage } from '@3db/io';
import type { AssemblyCommand, AssemblyDoc, Command, Id, PartDoc } from '@3db/model';

interface Undoable<D, C> {
  readonly doc: D;
  readonly canUndo: boolean;
  applyBatch(cmds: readonly C[], label: string): void;
  undo(): void;
  subscribe(fn: (doc: D) => void): () => void;
}

/** The open assembly as the link needs it (ADR 0253). */
export interface AiAssemblyHost {
  history: Undoable<AssemblyDoc, AssemblyCommand>;
  /** The user is in one of the assembly's PropertyManagers or dialogs, or dragging: a batch now would land in the middle of it. */
  busy(): boolean;
  /** The content of each part file `doc` uses, by file id; a file that cannot be read has no entry. */
  sources(doc: AssemblyDoc): Promise<Map<Id, Uint8Array>>;
  /** A part file by its path from the assembly's folder: only a .3dbx inside the project folder. Throws why not. */
  read(path: string): Promise<Uint8Array>;
}

export interface AiBridgeHost {
  history: Undoable<PartDoc, Command> & { readonly inTransaction: boolean };
  blobs(): ReadonlyMap<string, Uint8Array>;
  /** A part is what the user works on (not an assembly or a drawing). */
  isPart(): boolean;
  /** The open assembly; null when none is open. */
  assembly(): AiAssemblyHost | null;
  onStatus(status: AiBridgeStatus): void;
  /** The WebSocket class (the browser's; Node's in a test). */
  WebSocket?: typeof WebSocket;
}

export type AiBridgeStatus =
  | { state: 'off' }
  | { state: 'connecting' }
  | { state: 'on'; batches: number }
  | { state: 'error'; reason: 'format' | 'port' | 'refused' | 'closed'; detail?: string };

const SYNC_MS = 300;

export class AiBridge {
  private ws: WebSocket | null = null;
  /** Counts every change of the open document (the part's, the assembly's, or another document opened). */
  private version = 0;
  /** The version right after the agent's last batch: undo is allowed only while the document is still there. */
  private agentVersion = -1;
  private applying = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sent = new Set<string>();
  private unsubscribe: (() => void)[] = [];
  private batches = 0;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  /**
   * Messages go out in the order they are made, though some take a moment to make (an assembly's part files are read and hashed first): each waits
   * for the one before.
   */
  private queue: Promise<void> = Promise.resolve();
  /** The hash of each part file's content as read last (the store hands back the same bytes while the file is unchanged). */
  private hashes = new WeakMap<Uint8Array, string>();

  constructor(private readonly host: AiBridgeHost) {}

  /** Connects with the code the user typed; the status says how it goes. */
  connect(code: string): void {
    this.disconnect();
    const parsed = parseLiveCode(code);
    if ('error' in parsed) return this.host.onStatus({ state: 'error', reason: parsed.error as 'format' | 'port' });
    const Ws = this.host.WebSocket ?? WebSocket;
    const ws = new Ws(`ws://127.0.0.1:${parsed.port}`);
    this.ws = ws;
    this.batches = 0;
    this.agentVersion = -1;
    this.host.onStatus({ state: 'connecting' });
    this.deadline = setTimeout(() => {
      if (this.ws !== ws) return;
      this.stop();
      ws.close();
      this.host.onStatus({ state: 'error', reason: 'closed' });
    }, 10_000);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.sent.clear();
      const snapshot = this.snapshot();
      this.enqueue(async () => {
        const { open, blobs } = await this.opened(snapshot);
        return { type: 'hello', protocol: LIVE_PROTOCOL, token: parsed.token, version: snapshot.version, doc: snapshot.part, open, blobs };
      });
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      try {
        this.receive(JSON.parse(String(e.data)) as ServerMessage);
      } catch {
        this.stop();
        ws.close();
        this.host.onStatus({ state: 'error', reason: 'closed' });
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.stop();
      this.host.onStatus({ state: 'error', reason: e.code === 4401 || e.code === 4403 || e.code === 4409 || e.code === 4426 ? 'refused' : 'closed', detail: e.reason });
    };
    this.listen();
  }

  /** Listens to the histories open now: the part's, and the assembly's when one is open. */
  private listen(): void {
    for (const u of this.unsubscribe) u();
    const changed = () => {
      this.version++;
      if (!this.applying) this.scheduleSync();
    };
    const asm = this.host.assembly();
    this.unsubscribe = [this.host.history.subscribe(changed), ...(asm ? [asm.history.subscribe(changed)] : [])];
  }

  /**
   * The store put another document in place: a part opened (store.ts `load`), an assembly or a drawing shown. Listen to what is open now, and send it
   * now, so that the agent's next batch is checked against the document on the screen. The host must already return the new one.
   */
  historyReplaced(): void {
    if (!this.ws) return;
    this.version++;
    this.agentVersion = -1;
    this.listen();
    this.timer ??= setTimeout(() => undefined, 0);
    this.flush();
  }

  disconnect(): void {
    const ws = this.ws;
    this.stop();
    ws?.close();
    this.host.onStatus({ state: 'off' });
  }

  private stop(): void {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
    this.ws = null;
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Sends a message once those made before it are sent. A message that cannot be made (a file read fails unexpectedly) ends the link. */
  private enqueue(make: () => AppMessage | Promise<AppMessage>): void {
    const ws = this.ws;
    this.queue = this.queue
      .then(async () => {
        const msg = await make();
        // Edits during the handshake are included in hello when the socket opens.
        if (this.ws === ws && ws?.readyState === 1) ws.send(JSON.stringify(msg));
      })
      .catch(() => {
        if (this.ws !== ws) return;
        this.stop();
        ws?.close();
        this.host.onStatus({ state: 'error', reason: 'closed' });
      });
  }

  private blob(sha: string, data: Uint8Array, out: LiveBlobs): void {
    if (this.sent.has(sha)) return;
    out[sha] = toBase64(data);
    this.sent.add(sha);
  }

  /** What is open now, taken at once with its version: the content of an assembly's files is read afterwards. */
  private snapshot(): { version: number; part: PartDoc; assembly: { host: AiAssemblyHost; doc: AssemblyDoc } | null; isPart: boolean } {
    const asm = this.host.assembly();
    return { version: this.version, part: this.host.history.doc, assembly: asm && { host: asm, doc: asm.history.doc }, isPart: this.host.isPart() };
  }

  /** The open document as a message carries it, with the blobs not sent before: the part's, and the part files of an assembly. */
  private async opened(s: ReturnType<AiBridge['snapshot']>): Promise<{ open: LiveOpen; blobs: LiveBlobs }> {
    const blobs: LiveBlobs = {};
    for (const [sha, data] of this.host.blobs()) this.blob(sha, data, blobs);
    if (!s.assembly) return { open: s.isPart ? { kind: 'part' } : { kind: 'other' }, blobs };
    const sources: Record<Id, string> = {};
    for (const [id, data] of await s.assembly.host.sources(s.assembly.doc)) {
      const sha = this.hashes.get(data) ?? (await sha256Hex(data));
      this.hashes.set(data, sha);
      sources[id] = sha;
      this.blob(sha, data, blobs);
    }
    return { open: { kind: 'assembly', doc: s.assembly.doc, sources }, blobs };
  }

  private scheduleSync(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SYNC_MS);
  }

  /** Sends the user's changes now, if any wait. */
  private flush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    const snapshot = this.snapshot();
    this.enqueue(async () => {
      const { open, blobs } = await this.opened(snapshot);
      return { type: 'doc', version: snapshot.version, doc: snapshot.part, open, blobs };
    });
  }

  private refuse(id: number, reason: LiveRefusal, message: string): void {
    // the server's copy is behind: what it has not seen goes first, so its next try starts from the document on the screen
    if (reason === 'conflict') this.flush();
    const version = this.version;
    this.enqueue(() => ({ type: 'result', id, ok: false, reason, message, version }));
  }

  private answer(id: number): void {
    const version = this.version;
    this.enqueue(() => ({ type: 'result', id, ok: true, version }));
  }

  private receive(msg: ServerMessage): void {
    if (msg.type === 'welcome') {
      if (this.deadline) clearTimeout(this.deadline);
      this.deadline = null;
      return this.host.onStatus({ state: 'on', batches: this.batches });
    }
    const asm = this.host.assembly();
    if (msg.type === 'read') {
      const { id, path } = msg;
      return this.enqueue(async () => {
        if (!asm) return { type: 'file', id, ok: false, message: 'no assembly is open' };
        try {
          const data = await asm.read(path);
          return { type: 'file', id, ok: true, sha: await sha256Hex(data), data: toBase64(data) };
        } catch (e) {
          return { type: 'file', id, ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });
    }
    let h: Undoable<PartDoc, Command> | Undoable<AssemblyDoc, AssemblyCommand>;
    if (msg.target === 'assembly') {
      if (!asm) return this.refuse(msg.id, 'wrongDocument', 'no assembly is open');
      if (asm.busy()) return this.refuse(msg.id, 'busy', 'the user is editing the assembly');
      h = asm.history;
    } else {
      if (!this.host.isPart()) return this.refuse(msg.id, 'notPart', 'no part is open');
      if (this.host.history.inTransaction) return this.refuse(msg.id, 'busy', 'the user is editing');
      h = this.host.history;
    }
    if (this.timer || msg.base !== this.version) return this.refuse(msg.id, 'conflict', `the document is at ${this.version}, not ${msg.base}`);
    if (msg.type === 'undo') {
      if (this.agentVersion !== this.version || !h.canUndo) return this.refuse(msg.id, 'conflict', 'the document changed since the last batch');
      this.applying = true;
      try {
        h.undo();
      } finally {
        this.applying = false;
      }
      this.agentVersion = -1;
      return this.answer(msg.id);
    }
    this.applying = true;
    try {
      (h as Undoable<unknown, unknown>).applyBatch(msg.commands, msg.label);
    } catch (e) {
      return this.refuse(msg.id, 'invalid', e instanceof Error ? e.message : String(e));
    } finally {
      this.applying = false;
    }
    this.agentVersion = this.version;
    this.batches++;
    this.host.onStatus({ state: 'on', batches: this.batches });
    this.answer(msg.id);
  }
}
