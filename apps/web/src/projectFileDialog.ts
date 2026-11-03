import { useSyncExternalStore } from 'react';

/**
 * The file dialog of a project kept in the browser (ADR 0233): the system's open and save dialogs show the computer's folders, where such a
 * project is not, so the pickers ask here instead and the dialog component answers. One request at a time; a new one cancels the last.
 */
export type ProjectFileRequest =
  | {
      mode: 'open';
      folder: FileSystemDirectoryHandle;
      projectName: string;
      /** Lower-case extensions (".3dbx") of the files that can be chosen. */
      extensions: string[];
      /** The file input's `accept` for 「從電腦…」. */
      accept: string;
      /** 'open': a file of the computer is opened as it is; 'copy': it is copied into the project first (it must be inside it). */
      outside: 'open' | 'copy';
    }
  | { mode: 'save'; folder: FileSystemDirectoryHandle; projectName: string; suggestedName: string; extension: string };

/** What the dialog answers: a file of the project, a file of the computer (open, 'open' only), or null for 「取消」. */
export type ProjectFileAnswer = { handle: FileSystemFileHandle } | { file: File } | null;

let current: (ProjectFileRequest & { answer: (a: ProjectFileAnswer) => void }) | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function askProjectFile(request: ProjectFileRequest): Promise<ProjectFileAnswer> {
  current?.answer(null);
  return new Promise((resolve) => {
    current = { ...request, answer: resolve };
    changed();
  });
}

export function answerProjectFile(answer: ProjectFileAnswer): void {
  const c = current;
  current = null;
  changed();
  c?.answer(answer);
}

export function useProjectFileRequest(): ProjectFileRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
