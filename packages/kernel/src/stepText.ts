/**
 * ISO 10303-21 allows only ASCII in the text of a STEP file; a character outside it is written as an escape: `\X2\` + the UTF-16 code of each character as four
 * hex digits + `\X0\` (`\X4\` + eight digits for a character beyond the Basic Multilingual Plane). The library writes names as raw UTF-8 instead, which another
 * program reads as the code page of its own (a part called 基板 comes up in eDrawings as three characters of nonsense); the exchange functions put the text through
 * this before it leaves, so that every reader — the library's own among them, which decodes the escapes — gets the same names.
 *
 * Non-ASCII text can only be in a string of the file (everything else the writer makes is ASCII), so the whole text is taken in runs of non-ASCII characters.
 */
const hex = (n: number, digits: number) => n.toString(16).toUpperCase().padStart(digits, '0');

export function escapeStepText(text: string): string {
  return text.replace(/[^\x00-\x7f]+/gu, (run) => {
    let out = '';
    let bmp = '';
    const flush = () => {
      if (bmp !== '') out += `\\X2\\${bmp}\\X0\\`;
      bmp = '';
    };
    for (const ch of run) {
      const code = ch.codePointAt(0)!;
      if (code > 0xffff) {
        flush();
        out += `\\X4\\${hex(code, 8)}\\X0\\`;
      } else {
        bmp += hex(code, 4);
      }
    }
    flush();
    return out;
  });
}

/**
 * A STEP file whose strings hold raw non-ASCII bytes (against ISO 10303-21; SolidWorks 2020 writes the system code page, part-3's 夾具A as Big5 A7 A8
 * A8 E3 41) as one the library reads: those characters as escapes. The bytes are read as UTF-8 when they are valid UTF-8 (the library's own files
 * before `escapeStepText`, and most writers); otherwise as `legacy` (a WHATWG encoding label: the code page of the user's language), which the
 * caller reports, since the file does not say. The whole file is decoded before the strings are found: a Big5 character's second byte may be a
 * backslash or other ASCII. `encoding` is null when the file was ASCII and is returned as it was.
 */
export function stepBytesAsAscii(bytes: Uint8Array, legacy: string): { bytes: Uint8Array; encoding: string | null } {
  if (!bytes.some((b) => b >= 0x80)) return { bytes, encoding: null };
  let text: string;
  let encoding = 'utf-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    encoding = legacy;
    text = new TextDecoder(legacy).decode(bytes);
  }
  return { bytes: new TextEncoder().encode(escapeStepText(text)), encoding };
}
