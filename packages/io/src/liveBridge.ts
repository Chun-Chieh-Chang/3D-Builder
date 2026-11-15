/**
 * The live link between the open app and an AI agent's MCP server (ADR 0238): the messages both ends send over a WebSocket on this computer, and the
 * connection code the user types into the app. The server keeps a copy of the app's part: the agent's batches are checked and rebuilt there first, and
 * only a batch that is kept there is sent to the app, which applies it as one undo step or refuses it. What the user changes in the app is sent back,
 * so the copy is always the part on the screen.
 *
 * Pure data and checks: no socket here. Both ends import it (the app on its main thread, the server in Node).
 */
import type { AssemblyCommand, AssemblyDoc, Command, Id, PartDoc } from '@3db/model';

/**
 * Changed when a message changes shape: an app and a server of different versions refuse each other instead of misreading. 2: the open document
 * (`open`) and the target of a batch, for assemblies (ADR 0253).
 */
export const LIVE_PROTOCOL = 2;

/** Blobs (imported STEP, STL, images, and an open assembly's part files) by SHA-256, as base64. */
export type LiveBlobs = Record<string, string>;

/**
 * The document the user has open (ADR 0253). `doc` in the messages is always the part history's document: while an assembly is open, that is an
 * empty part, and the assembly comes here. `sources`: the SHA-256 of each part file the assembly uses, by its file id (the file's bytes are among the
 * blobs); a file the app could not read has no entry.
 */
export type LiveOpen = { kind: 'part' } | { kind: 'assembly'; doc: AssemblyDoc; sources: Record<Id, string> } | { kind: 'other' };

export type AppMessage =
  | { type: 'hello'; protocol: number; token: string; version: number; doc: PartDoc; open: LiveOpen; blobs: LiveBlobs }
  /** The user changed the part or the assembly (or opened another document). `blobs`: only those not sent before. */
  | { type: 'doc'; version: number; doc: PartDoc; open: LiveOpen; blobs: LiveBlobs }
  | { type: 'result'; id: number; ok: true; version: number }
  | { type: 'result'; id: number; ok: false; reason: LiveRefusal; message: string; version: number }
  /** The answer to `read`: the file's bytes (base64) and their SHA-256, or why not. */
  | { type: 'file'; id: number; ok: true; sha: string; data: string }
  | { type: 'file'; id: number; ok: false; message: string };

export type LiveBatch =
  | { target: 'part'; commands: Command[] }
  | { target: 'assembly'; commands: AssemblyCommand[] };

export type ServerMessage =
  | { type: 'welcome'; protocol: number; server: string }
  /** Apply these commands to the open part or assembly as one undo step, if the document is still at version `base`. */
  | ({ type: 'apply'; id: number; base: number; label: string } & LiveBatch)
  /** Take back the agent's last batch, if nothing happened since (the document is still at version `base`). */
  | { type: 'undo'; id: number; base: number; target: LiveBatch['target'] }
  /**
   * Read a part file for the open assembly (ADR 0253): `path` is relative to the assembly's folder, as a file entry of the assembly has it. The app
   * reads only `.3dbx` files inside its project folder.
   */
  | { type: 'read'; id: number; path: string };

/**
 * Why the app refused: `conflict` the document changed since the server last saw it; `busy` the user is in a sketch, a feature's settings or an
 * assembly's PropertyManager; `notPart` a batch for a part while no part is open; `wrongDocument` a batch for an assembly while none is open;
 * `invalid` a command failed in the app.
 */
export type LiveRefusal = 'conflict' | 'busy' | 'notPart' | 'wrongDocument' | 'invalid';

/** Close codes (4000–4999 are the application's): why the server closed the link. */
export const LIVE_CLOSE = { badToken: 4401, badOrigin: 4403, timeout: 4408, busy: 4409, protocol: 4426, badMessage: 4400 } as const;

/** The connection code is `<port>-<token>`: the token is 16 letters and digits, the port the one the server listens on. */
export const LIVE_TOKEN = /^[a-z0-9]{16}$/;

export function liveCode(port: number, token: string): string {
  return `${port}-${token}`;
}

/** The port and token of a connection code, or why it is not one (spaces and capitals are forgiven: the user types it). */
export function parseLiveCode(code: string): { port: number; token: string } | { error: string } {
  const m = /^(\d{1,5})-([a-z0-9]{16})$/.exec(code.trim().toLowerCase());
  if (!m) return { error: 'format' };
  const port = Number(m[1]);
  if (!(Number.isInteger(port) && port >= 1024 && port <= 65535)) return { error: 'port' };
  return { port, token: m[2]! };
}

/** Is `origin` (the Origin of the page that connects) one the server takes: the app served from this computer, or the desktop app. */
export function liveOriginAllowed(origin: string | undefined, extra: readonly string[] = []): boolean {
  if (origin === undefined) return true; // not a browser: a page of another site always sends one
  if (extra.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === 'tauri:') return true;
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]', 'tauri.localhost'].includes(u.hostname);
  } catch {
    return false;
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
