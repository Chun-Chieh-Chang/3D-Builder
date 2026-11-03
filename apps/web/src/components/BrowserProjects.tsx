import { useEffect, useRef, useState } from 'react';
import { t } from '@3db/i18n';
import { browserProjectsAvailable, freeName, lastExport, listBrowserProjects, nameProblem, pathProblem, storageState, type StorageState } from '../browserProjects';
import { chooseFile, fileIn, listFiles, writeFile } from '../files';
import { answerProjectFile, useProjectFileRequest } from '../projectFileDialog';
import { store, useStore } from '../state/store';

/** Bytes as people read them: 1.2 MB, 3.4 GB. */
function size(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** The browser projects, read again whenever one is made, imported, exported or deleted. */
function useBrowserProjects(): string[] | null {
  const serial = useStore((s) => s.browserProjectsSerial);
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    listBrowserProjects().then(
      (n) => live && setNames(n),
      () => live && setNames([]),
    );
    return () => {
      live = false;
    };
  }, [serial]);
  return names;
}

/**
 * The browser projects (ADR 0233): 「使用」 one, make one, import one. In the project-folder dialog `manage` is off (choosing is what is asked); in
 * 「瀏覽器內專案…」 it is on, with 「匯出」, 「刪除」 and when each was last exported.
 */
export function BrowserProjectList({ manage }: { manage: boolean }) {
  const names = useBrowserProjects();
  const current = useStore((s) => (s.projectInBrowser ? s.projectName : null));
  const serial = useStore((s) => s.browserProjectsSerial);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const why = name === '' ? null : nameProblem(name) ?? (names?.includes(name) ? t('bproj.taken', { name }) : null);
  if (!browserProjectsAvailable()) return null;
  const create = async () => {
    if (name === '' || why) return;
    if (await store.newBrowserProject(name)) setName('');
  };
  return (
    <div className="browser-projects" data-browser-projects data-serial={serial}>
      {names === null ? null : names.length === 0 ? (
        <p className="muted">{t('bproj.none')}</p>
      ) : (
        <ul className="browser-project-list">
          {names.map((n) => {
            const at = lastExport(n);
            return (
              <li key={n} data-browser-project={n}>
                <span className="browser-project-name">
                  {n}
                  {n === current && <span className="muted"> {t('bproj.current')}</span>}
                  {manage && <span className="hint">{at === null ? t('bproj.neverExported') : t('bproj.lastExport', { when: new Date(at).toLocaleString() })}</span>}
                </span>
                {deleting === n ? (
                  <>
                    <span className="browser-project-confirm">{t('bproj.deleteConfirm', { name: n })}</span>
                    <button className="danger" data-delete-yes onClick={() => void store.removeBrowserProject(n).then(() => setDeleting(null))}>
                      {t('bproj.deleteYes')}
                    </button>
                    <button onClick={() => setDeleting(null)}>{t('export.cancel')}</button>
                  </>
                ) : (
                  <>
                    <button className="primary" data-use onClick={() => void store.useBrowserProject(n)}>
                      {t('bproj.use')}
                    </button>
                    {manage && (
                      <>
                        <button data-export onClick={() => void store.exportBrowserProjectZip(n)}>
                          {t('bproj.export')}
                        </button>
                        <button data-delete onClick={() => setDeleting(n)}>
                          {t('bproj.delete')}
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="browser-project-new">
        <input data-new-name value={name} placeholder={t('bproj.newName')} aria-label={t('bproj.newName')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
        <button data-create disabled={name === '' || !!why} onClick={() => void create()}>
          {t('bproj.create')}
        </button>
        <button data-import onClick={() => void store.importBrowserProjectZip()}>
          {t('bproj.import')}
        </button>
      </div>
      {why && <p className="hint error-text">{why}</p>}
    </div>
  );
}

/** 「檔案 → 瀏覽器內專案…」: the projects, what keeping them depends on, and how much room they take. */
export function BrowserProjectsDialog() {
  const open = useStore((s) => s.dialog === 'browserProjects');
  const serial = useStore((s) => s.browserProjectsSerial);
  const [storage, setStorage] = useState<StorageState | null>(null);
  useEffect(() => {
    if (open) void storageState().then(setStorage);
  }, [open, serial]);
  if (!open) return null;
  const close = () => store.openDialog(null);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide" role="dialog" aria-label={t('bproj.title')} data-browser-projects-dialog onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('bproj.title')}</h3>
        <p>{t('bproj.intro')}</p>
        <p className="warning-text">{t('bproj.risk')}</p>
        <BrowserProjectList manage />
        {storage && (
          <p className="hint" data-storage>
            {storage.persisted === true ? t('bproj.persisted') : storage.persisted === false ? t('bproj.notPersisted') : t('bproj.persistUnknown')}
            {storage.usage !== null && storage.quota !== null && ` ${t('bproj.usage', { used: size(storage.usage), quota: size(storage.quota) })}`}
          </p>
        )}
        <div className="modal-actions">
          <button onClick={close}>{t('bproj.close')}</button>
        </div>
      </div>
    </div>
  );
}

/** The open and save dialog of a browser project: the system's dialogs show only the computer. */
export function ProjectFileDialog() {
  const request = useProjectFileRequest();
  const [files, setFiles] = useState<string[] | null>(null);
  const [name, setName] = useState('');
  const [replace, setReplace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setFiles(null);
    setReplace(null);
    setError(null);
    if (!request) return;
    if (request.mode === 'save') setName(request.suggestedName);
    const extensions = request.mode === 'open' ? request.extensions : [request.extension];
    let live = true;
    listFiles(request.folder, extensions).then(
      (r) => live && setFiles(r.files),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    setTimeout(() => input.current?.select(), 0);
    return () => {
      live = false;
    };
  }, [request]);
  if (!request) return null;
  const cancel = () => answerProjectFile(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const choose = (path: string) => fileIn(request.folder, path).then((handle) => answerProjectFile({ handle }), fail);

  const outside = async () => {
    if (request.mode !== 'open') return;
    try {
      const file = await chooseFile(request.accept);
      if (!file) return;
      if (request.outside === 'open') return answerProjectFile({ file });
      // copied into the project at its top, under a name no file there has
      const taken = new Set<string>();
      for await (const [n] of request.folder.entries()) taken.add(n);
      const target = freeName(file.name, taken);
      const handle = await request.folder.getFileHandle(target, { create: true });
      await writeFile(handle, new Uint8Array(await file.arrayBuffer()));
      store.notify(t('pfile.copied', { name: target }));
      answerProjectFile({ handle });
    } catch (e) {
      fail(e);
    }
  };

  const save = async (confirmed: boolean) => {
    if (request.mode !== 'save') return;
    const ext = request.extension;
    const path = name.trim().toLowerCase().endsWith(ext) ? name.trim() : `${name.trim()}${ext}`;
    const why = pathProblem(path);
    if (why) return setError(why);
    try {
      if (!confirmed && files?.some((f) => f.toLowerCase() === path.toLowerCase())) return setReplace(path);
      const parts = path.split('/');
      let dir = request.folder;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      answerProjectFile({ handle: await dir.getFileHandle(parts[parts.length - 1]!, { create: true }) });
    } catch (e) {
      fail(e);
    }
  };

  const title = request.mode === 'open' ? t('pfile.openTitle', { project: request.projectName }) : t('pfile.saveTitle', { project: request.projectName });
  return (
    <div className="modal-backdrop project-file-backdrop" onPointerDown={cancel}>
      <div className="modal wide" role="dialog" aria-label={title} data-project-file={request.mode} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && cancel()}>
        <h3>{title}</h3>
        {request.mode === 'save' && (
          <label className="project-file-name">
            <span className="hint">{t('pfile.name')}</span>
            <input
              ref={input}
              data-file-name
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setReplace(null);
                setError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void save(false)}
            />
          </label>
        )}
        {request.mode === 'save' && files && files.length > 0 && <p className="hint">{t('pfile.existing')}</p>}
        {files === null ? null : files.length === 0 ? (
          request.mode === 'open' && <p className="muted">{t('pfile.empty')}</p>
        ) : (
          <ul className="project-file-list">
            {files.map((f) => (
              <li key={f}>
                <button data-file={f} onClick={() => (request.mode === 'open' ? void choose(f) : (setName(f), setReplace(null)))} onDoubleClick={() => request.mode === 'save' && void save(true)}>
                  {f}
                </button>
              </li>
            ))}
          </ul>
        )}
        {replace && <p className="warning-text">{t('pfile.replace', { name: replace })}</p>}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          {request.mode === 'open' && (
            <button data-outside onClick={() => void outside()}>
              {request.outside === 'copy' ? t('pfile.copyFromComputer') : t('pfile.fromComputer')}
            </button>
          )}
          {request.mode === 'save' &&
            (replace ? (
              <button className="primary" data-replace onClick={() => void save(true)}>
                {t('pfile.replaceYes')}
              </button>
            ) : (
              <button className="primary" data-save onClick={() => void save(false)}>
                {t('pfile.save')}
              </button>
            ))}
          <button onClick={cancel}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
