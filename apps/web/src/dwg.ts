import { t } from '@3db/i18n';

type Invoke = <T>(command: string, args: Record<string, string>) => Promise<T>;
function invoke(): Invoke {
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
  if (!tauri?.invoke) throw new Error(t('drawingUi.dwgDesktopOnly'));
  return tauri.invoke;
}

export function dwgAvailable(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

async function convert(direction: 'export' | 'import' | 'setup', data: string): Promise<Uint8Array> {
  const result = JSON.parse(await invoke()<string>('dwg_convert', { direction, data }));
  if (typeof result.base64 !== 'string') throw new Error(t('drawingUi.dwgInvalidReply'));
  return Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
}

export const exportDwg = (dxf: string): Promise<Uint8Array> => convert('export', dxf);
export async function installDwgEngine(): Promise<void> { await convert('setup', ''); }

export async function importDwg(bytes: Uint8Array): Promise<string> {
  if (bytes.length > 64 * 1024 * 1024) throw new Error(t('drawingUi.dwgTooLarge'));
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return new TextDecoder().decode(await convert('import', btoa(chunks.join(''))));
}
