/**
 * The server end of the live link to the open app (ADR 0238). A WebSocket server on 127.0.0.1 only, a token made at start that the user types into
 * the app (with the port: the connection code), one app at a time. A page of another site cannot use it: it would need the token, the Origin must be
 * the app's own, and after five wrong tokens every attempt is refused for a minute.
 */
import { randomBytes, createHash } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { fromBase64, LIVE_CLOSE, LIVE_PROTOCOL, liveCode, liveOriginAllowed, type AppMessage, type LiveBlobs, type ServerMessage } from '@3db/io';
import type { Command, PartDoc } from '@3db/model';

export interface BridgeOptions {
  /** 0: a free port the system gives. */
  port?: number;
  /** Origins taken besides the app's own (THREEDB_LIVE_ORIGINS). */
  origins?: readonly string[];
  /** How long the app has to answer a batch. */
  answerMs?: number;
  token?: string;
  onClose?: () => void;
  log?: (text: string) => void;
}

export type AppAnswer = Extract<AppMessage, { type: 'result' }>;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

export function newToken(): string {
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** The blobs of a message, each checked against its hash: data that is not what its name says is left out. */
function blobsOf(raw: LiveBlobs | undefined): { blobs: Map<string, Uint8Array>; bad: string[] } {
  const blobs = new Map<string, Uint8Array>();
  const bad: string[] = [];
  for (const [sha, text] of Object.entries(raw ?? {})) {
    const data = fromBase64(text);
    if (createHash('sha256').update(data).digest('hex') === sha) blobs.set(sha, data);
    else bad.push(sha);
  }
  return { blobs, bad };
}

export class LiveBridge {
  readonly token: string;
  private wss: WebSocketServer | null = null;
  private app: WebSocket | null = null;
  private port = 0;
  /** The part's version in the app as the server last knew it. */
  version = -1;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (a: AppAnswer) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private failures = 0;
  private lockedUntil = 0;
  /**
   * The part the app sent last that the copy does not have yet. It is not loaded here: a tool call loads it first thing (`takePending`), in the same
   * queue as every other use of the part. Loading it here would wait on that queue, and a tool call waiting for the app's answer holds it.
   */
  private pending: { doc: PartDoc; version: number } | null = null;
  /** Every blob the app has sent, by hash: a part sent later may use one sent before. */
  private readonly blobs = new Map<string, Uint8Array>();

  constructor(private readonly options: BridgeOptions) {
    this.token = options.token ?? newToken();
  }

  get connected(): boolean {
    return this.app !== null;
  }

  get code(): string {
    return liveCode(this.port, this.token);
  }

  get listeningPort(): number {
    return this.port;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port: this.options.port ?? 0, maxPayload: 256 * 1024 * 1024 });
      wss.once('error', reject);
      wss.once('listening', () => {
        this.wss = wss;
        this.port = (wss.address() as { port: number }).port;
        resolve(this.port);
      });
      wss.on('connection', (ws, req) => this.accept(ws, req));
    });
  }

  stop(): Promise<void> {
    for (const w of this.waiting.values()) {
      clearTimeout(w.timer);
      w.reject(new Error('the live link closed'));
    }
    this.waiting.clear();
    this.app?.close();
    this.app = null;
    return new Promise((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }

  private accept(ws: WebSocket, req: IncomingMessage): void {
    if (!liveOriginAllowed(req.headers.origin, this.options.origins)) return ws.close(LIVE_CLOSE.badOrigin, 'origin not allowed');
    let greeted = false;
    // the first message must be the hello, soon
    const deadline = setTimeout(() => !greeted && ws.close(LIVE_CLOSE.badMessage, 'no hello'), 10_000);
    ws.on('message', (data) => {
      let msg: AppMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return ws.close(LIVE_CLOSE.badMessage, 'not JSON');
      }
      if (!greeted) {
        clearTimeout(deadline);
        if (msg.type !== 'hello') return ws.close(LIVE_CLOSE.badMessage, 'hello first');
        if (Date.now() < this.lockedUntil) return ws.close(LIVE_CLOSE.badToken, 'too many wrong codes: wait a minute');
        if (msg.token !== this.token) {
          if (++this.failures >= MAX_FAILURES) {
            this.lockedUntil = Date.now() + LOCK_MS;
            this.failures = 0;
          }
          return ws.close(LIVE_CLOSE.badToken, 'wrong code');
        }
        if (msg.protocol !== LIVE_PROTOCOL) return ws.close(LIVE_CLOSE.protocol, `protocol ${LIVE_PROTOCOL} expected`);
        if (this.app) return ws.close(LIVE_CLOSE.busy, 'another app is connected');
        this.failures = 0;
        greeted = true;
        this.app = ws;
        ws.on('close', () => {
          if (this.app !== ws) return;
          this.app = null;
          for (const w of this.waiting.values()) {
            clearTimeout(w.timer);
            w.reject(new Error('the app closed the live link'));
          }
          this.waiting.clear();
          this.options.onClose?.();
        });
        this.blobs.clear();
        this.handle(msg, true, ws);
        return;
      }
      this.handle(msg, false, ws);
    });
  }

  private handle(msg: AppMessage, first: boolean, ws: WebSocket): void {
    if (msg.type === 'hello' || msg.type === 'doc') {
      if (typeof msg.version !== 'number' || typeof msg.doc !== 'object' || msg.doc === null) return ws.close(LIVE_CLOSE.badMessage, 'a part is expected');
      const { blobs, bad } = blobsOf(msg.blobs);
      if (bad.length) this.options.log?.(`live link: ${bad.length} blob(s) did not match their hash and were left out`);
      for (const [k, v] of blobs) this.blobs.set(k, v);
      this.pending = { doc: msg.doc, version: msg.version };
      this.version = msg.version;
      if (first) this.send({ type: 'welcome', protocol: LIVE_PROTOCOL, server: '3d-builder-mcp' });
      return;
    }
    if (msg.type === 'result') {
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      clearTimeout(w.timer);
      this.version = msg.version;
      w.resolve(msg);
    }
  }

  /** The part the app sent that the copy does not have yet, with every blob it has sent; null when the copy is up to date. */
  takePending(): { doc: PartDoc; blobs: ReadonlyMap<string, Uint8Array> } | null {
    const p = this.pending;
    this.pending = null;
    return p && { doc: p.doc, blobs: this.blobs };
  }

  private send(msg: ServerMessage): void {
    this.app?.send(JSON.stringify(msg));
  }

  /** Asks the app to apply a batch, or to take back the last one; resolves with its answer. */
  request(what: { kind: 'apply'; commands: Command[]; label: string } | { kind: 'undo' }): Promise<AppAnswer> {
    if (!this.app) return Promise.reject(new Error('no app is connected'));
    const id = this.nextId++;
    const msg: ServerMessage = what.kind === 'apply' ? { type: 'apply', id, base: this.version, label: what.label, commands: what.commands } : { type: 'undo', id, base: this.version };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        // the app may still apply it later, and the copy here would no longer be the part on the screen: the link is closed, and a new one starts
        // from the app's part (its hello)
        this.app?.close(LIVE_CLOSE.timeout, 'no answer');
        reject(new Error(`the app did not answer in ${(this.options.answerMs ?? 15_000) / 1000} s: the live link is closed; connect again from the app`));
      }, this.options.answerMs ?? 15_000);
      this.waiting.set(id, { resolve, reject, timer });
      this.send(msg);
    });
  }
}
