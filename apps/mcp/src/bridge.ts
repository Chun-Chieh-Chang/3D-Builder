/**
 * The server end of the live link to the open app (ADR 0238). A WebSocket server on 127.0.0.1 only, a token made at start that the user types into
 * the app (with the port: the connection code), one app at a time. A page of another site cannot use it: it would need the token, the Origin must be
 * the app's own, and after five wrong tokens every attempt is refused for a minute.
 */
import { randomBytes, createHash } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { fromBase64, LIVE_CLOSE, LIVE_PROBE_PATH, LIVE_PROBE_REPLY, LIVE_PROTOCOL, liveCode, liveOriginAllowed, type AppMessage, type LiveBatch, type LiveBlobs, type LiveOpen, type ServerMessage } from '@3db/io';
import type { PartDoc } from '@3db/model';

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
export type FileAnswer = Extract<AppMessage, { type: 'file' }>;

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

/** The shape of an open document as a message carries it: an assembly needs its document and the hashes of its sources. */
function validOpen(open: unknown): open is LiveOpen {
  if (typeof open !== 'object' || open === null) return false;
  const o = open as { kind?: unknown; doc?: unknown; sources?: unknown };
  if (o.kind === 'part' || o.kind === 'other') return true;
  if (o.kind !== 'assembly' || typeof o.doc !== 'object' || o.doc === null || typeof o.sources !== 'object' || o.sources === null) return false;
  return Object.values(o.sources).every((sha) => typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha));
}

export class LiveBridge {
  readonly token: string;
  private wss: WebSocketServer | null = null;
  private app: WebSocket | null = null;
  private port = 0;
  /** The part's version in the app as the server last knew it. */
  version = -1;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (a: AppAnswer | FileAnswer) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private failures = 0;
  private lockedUntil = 0;
  /**
   * The part the app sent last that the copy does not have yet. It is not loaded here: a tool call loads it first thing (`takePending`), in the same
   * queue as every other use of the part. Loading it here would wait on that queue, and a tool call waiting for the app's answer holds it.
   */
  private pending: { doc: PartDoc; open: LiveOpen; version: number } | null = null;
  /** The document open in the app as last sent (ADR 0253): what the tools may change. */
  open: LiveOpen = { kind: 'part' };
  /** Every blob the app has sent, by hash: a part sent later may use one sent before. */
  private readonly blobs = new Map<string, Uint8Array>();

  constructor(private readonly options: BridgeOptions) {
    this.token = options.token ?? newToken();
  }

  /** Every blob the app has sent, by hash (kept up to date: the same map). */
  get received(): ReadonlyMap<string, Uint8Array> {
    return this.blobs;
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
    const wss = this.wss;
    this.wss = null;
    this.app = null;
    if (!wss) return Promise.resolve();
    return new Promise((resolve) => {
      wss.close(() => resolve());
      for (const socket of wss.clients) socket.terminate();
    });
  }

  private accept(ws: WebSocket, req: IncomingMessage): void {
    if (!liveOriginAllowed(req.headers.origin, this.options.origins)) return ws.close(LIVE_CLOSE.badOrigin, 'origin not allowed');
    if (req.url === LIVE_PROBE_PATH) {
      ws.send(LIVE_PROBE_REPLY);
      ws.close();
      return;
    }
    let greeted = false;
    // the first message must be the hello, soon
    const deadline = setTimeout(() => !greeted && ws.close(LIVE_CLOSE.badMessage, 'no hello'), 10_000);
    ws.once('close', () => clearTimeout(deadline));
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
      if (!validOpen(msg.open)) return ws.close(LIVE_CLOSE.badMessage, 'the open document is expected');
      const { blobs, bad } = blobsOf(msg.blobs);
      if (bad.length) this.options.log?.(`live link: ${bad.length} blob(s) did not match their hash and were left out`);
      for (const [k, v] of blobs) this.blobs.set(k, v);
      this.pending = { doc: msg.doc, open: msg.open, version: msg.version };
      this.open = msg.open;
      this.version = msg.version;
      if (first) this.send({ type: 'welcome', protocol: LIVE_PROTOCOL, server: '3d-builder-mcp' });
      return;
    }
    if (msg.type === 'result' || msg.type === 'file') {
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      clearTimeout(w.timer);
      if (msg.type === 'result') this.version = msg.version;
      w.resolve(msg);
    }
  }

  /** What the app sent that the copies do not have yet (its part, and the document open), with every blob it has sent; null when they are up to date. */
  takePending(): { doc: PartDoc; open: LiveOpen; blobs: ReadonlyMap<string, Uint8Array> } | null {
    const p = this.pending;
    this.pending = null;
    return p && { doc: p.doc, open: p.open, blobs: this.blobs };
  }

  private send(msg: ServerMessage): void {
    this.app?.send(JSON.stringify(msg));
  }

  /** Asks the app to apply a batch to its part or assembly, or to take back the last one; resolves with its answer. */
  request(what: ({ kind: 'apply'; label: string } & LiveBatch) | { kind: 'undo'; target: LiveBatch['target'] }): Promise<AppAnswer> {
    if (!this.app) return Promise.reject(new Error('no app is connected'));
    const id = this.nextId++;
    const msg: ServerMessage = what.kind === 'apply'
      ? (what.target === 'part'
          ? { type: 'apply', id, base: this.version, label: what.label, target: 'part', commands: what.commands }
          : { type: 'apply', id, base: this.version, label: what.label, target: 'assembly', commands: what.commands })
      : { type: 'undo', id, base: this.version, target: what.target };
    // the app may still apply it later, and the copy here would no longer be the document on the screen: the link is closed, and a new one starts
    // from the app's document (its hello)
    return this.ask(msg, true) as Promise<AppAnswer>;
  }

  /**
   * Asks the app for a part file of the open assembly (ADR 0253), by its path from the assembly's folder; resolves with its bytes, checked against
   * the hash the app gives, or rejects saying why not. Reading changes nothing, so a read the app does not answer fails without closing the link.
   */
  async readFile(path: string): Promise<{ sha: string; data: Uint8Array }> {
    if (!this.app) throw new Error('no app is connected');
    const answer = (await this.ask({ type: 'read', id: this.nextId++, path }, false)) as FileAnswer;
    if (!answer.ok) throw new Error(answer.message);
    const data = fromBase64(answer.data);
    if (createHash('sha256').update(data).digest('hex') !== answer.sha) throw new Error(`the app sent ${path} with a hash that does not match its bytes`);
    this.blobs.set(answer.sha, data);
    return { sha: answer.sha, data };
  }

  private ask(msg: Extract<ServerMessage, { id: number }>, closeOnTimeout: boolean): Promise<AppAnswer | FileAnswer> {
    const ms = this.options.answerMs ?? 15_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(msg.id);
        if (closeOnTimeout) {
          this.app?.close(LIVE_CLOSE.timeout, 'no answer');
          reject(new Error(`the app did not answer in ${ms / 1000} s: the live link is closed; connect again from the app`));
        } else reject(new Error(`the app did not answer in ${ms / 1000} s`));
      }, ms);
      this.waiting.set(msg.id, { resolve, reject, timer });
      this.send(msg);
    });
  }
}
