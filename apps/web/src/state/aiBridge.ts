/**
 * The app end of the live link to an AI agent's MCP server (ADR 0238). The user types the connection code; the part is sent, the agent's batches come
 * back and are applied as one undo step each, or refused: when the part changed since the server saw it, while the user is in a sketch or a feature's
 * settings, or when no part is open. The user's own changes are sent to the server 300 ms after the last one.
 *
 * Nothing of the store here: what it needs is passed in, so that a test runs it in Node against the real server.
 */
import { LIVE_PROTOCOL, parseLiveCode, toBase64, type AppMessage, type LiveBlobs, type LiveRefusal, type ServerMessage } from '@3db/io';
import type { Command, PartDoc } from '@3db/model';

export interface AiBridgeHost {
  history: {
    readonly doc: PartDoc;
    readonly inTransaction: boolean;
    readonly canUndo: boolean;
    applyBatch(cmds: readonly Command[], label: string): void;
    undo(): void;
    subscribe(fn: (doc: PartDoc) => void): () => void;
  };
  blobs(): ReadonlyMap<string, Uint8Array>;
  /** A part is what the user works on (not an assembly or a drawing). */
  isPart(): boolean;
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
  private version = 0;
  /** The version right after the agent's last batch: undo is allowed only while the part is still there. */
  private agentVersion = -1;
  private applying = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sent = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private batches = 0;
  private deadline: ReturnType<typeof setTimeout> | null = null;

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
      this.send({ type: 'hello', protocol: LIVE_PROTOCOL, token: parsed.token, version: this.version, doc: this.host.history.doc, blobs: this.newBlobs() });
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
    this.unsubscribe = this.host.history.subscribe(() => {
      this.version++;
      if (!this.applying) this.scheduleSync();
    });
  }

  /**
   * The store put a new history in place (it does so when a part is opened, store.ts `load`): listen to that one, and send its part now, so that the
   * agent's next batch is checked against the part on the screen. `host.history` must already return the new one.
   */
  historyReplaced(): void {
    if (!this.ws) return;
    this.unsubscribe?.();
    this.version++;
    this.agentVersion = -1;
    this.unsubscribe = this.host.history.subscribe(() => {
      this.version++;
      if (!this.applying) this.scheduleSync();
    });
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
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private send(msg: AppMessage): void {
    // Edits during the handshake are included in hello when the socket opens.
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private newBlobs(): LiveBlobs {
    const out: LiveBlobs = {};
    for (const [sha, data] of this.host.blobs()) {
      if (this.sent.has(sha)) continue;
      out[sha] = toBase64(data);
      this.sent.add(sha);
    }
    return out;
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
    this.send({ type: 'doc', version: this.version, doc: this.host.history.doc, blobs: this.newBlobs() });
  }

  private refuse(id: number, reason: LiveRefusal, message: string): void {
    // the server's copy is behind: what it has not seen goes first, so its next try starts from the part on the screen
    if (reason === 'conflict') this.flush();
    this.send({ type: 'result', id, ok: false, reason, message, version: this.version });
  }

  private receive(msg: ServerMessage): void {
    if (msg.type === 'welcome') {
      if (this.deadline) clearTimeout(this.deadline);
      this.deadline = null;
      return this.host.onStatus({ state: 'on', batches: this.batches });
    }
    const h = this.host.history;
    if (!this.host.isPart()) return this.refuse(msg.id, 'notPart', 'no part is open');
    if (h.inTransaction) return this.refuse(msg.id, 'busy', 'the user is editing');
    if (this.timer || msg.base !== this.version) return this.refuse(msg.id, 'conflict', `the part is at ${this.version}, not ${msg.base}`);
    if (msg.type === 'undo') {
      if (this.agentVersion !== this.version || !h.canUndo) return this.refuse(msg.id, 'conflict', 'the part changed since the last batch');
      this.applying = true;
      try {
        h.undo();
      } finally {
        this.applying = false;
      }
      this.agentVersion = -1;
      return this.send({ type: 'result', id: msg.id, ok: true, version: this.version });
    }
    this.applying = true;
    try {
      h.applyBatch(msg.commands, msg.label);
    } catch (e) {
      return this.refuse(msg.id, 'invalid', e instanceof Error ? e.message : String(e));
    } finally {
      this.applying = false;
    }
    this.agentVersion = this.version;
    this.batches++;
    this.host.onStatus({ state: 'on', batches: this.batches });
    this.send({ type: 'result', id: msg.id, ok: true, version: this.version });
  }
}
