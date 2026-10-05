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
