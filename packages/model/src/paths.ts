/**
 * Paths of the files an assembly uses (B9.4). A file is referred to relative to the assembly file's
 * folder, "/" separated ("定位板.3dbx", "../零件/銷.3dbx"). Folders are written the same way relative to
 * the project folder, where "" is the project folder itself.
 */

/** Segments without "" and "."; ".." removes the segment before it where there is one. */
function segments(path: string): string[] {
  const out: string[] = [];
  for (const s of path.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else out.push(s);
  }
  return out;
}

export const normalizePath = (path: string): string => segments(path).join('/');

/** `path` (relative to `folder`) as seen from the folder `folder` is relative to. */
export const joinPath = (folder: string, path: string): string => normalizePath(folder ? `${folder}/${path}` : path);

/** The path from `folder` to the file `target`, both relative to the same folder. */
export function relativePath(folder: string, target: string): string {
  const from = segments(folder);
  const to = segments(target);
  let common = 0;
  // Only the target's folders can be shared: its last segment is the file.
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/');
}

export const dirName = (path: string): string => segments(path).slice(0, -1).join('/');

export const baseName = (path: string): string => segments(path).at(-1) ?? '';

/** Whether `path` can name a file the way FileRef paths do: relative, "/" separated, in its shortest form. */
export function isFilePath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path)) return false;
  const last = baseName(path);
  return last !== '' && last !== '..' && normalizePath(path) === path;
}
