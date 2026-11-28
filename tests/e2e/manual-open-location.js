// await __openLocation.run();
// Use real browser file handles and IndexedDB; substitute the native dialogs and the input gesture.
const filesUrl = performance.getEntriesByType('resource').map((e) => e.name).find((url) => new URL(url).pathname.endsWith('/src/files.ts'));
const files = await import(filesUrl);
const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
const M = await import(`${root}packages/model/src/index.ts`);
const IO = await import(`${root}packages/io/src/index.ts`);

window.__openLocation = { run: async () => {
  const storage = await navigator.storage.getDirectory();
  const project = await storage.getDirectoryHandle('open-project', { create: true });
  const other = await storage.getDirectoryHandle('open-recent', { create: true });
  const recentFile = await other.getFileHandle('recent.3dbx', { create: true });
  const projectFile = await project.getFileHandle('example.3dbx', { create: true });
  const drawingFile = await other.getFileHandle('sketch.3dbd', { create: true });
  const drawingBytes = await IO.writeDrawingFile(M.createEmptyDrawing());
  const writable = await drawingFile.createWritable();
  await writable.write(drawingBytes);
  await writable.close();
  const originalOpen = window.showOpenFilePicker;
  const originalSave = window.showSaveFilePicker;
  const originalDir = window.showDirectoryPicker;
  let startIn;
  let openId;
  let saveId;
  let choice = recentFile;
  let dirStartIn;
  let dirOptions;
  let dirAnswer = null;
  window.showOpenFilePicker = async (options) => {
    startIn = options.startIn;
    openId = options.id;
    if (!choice) throw new DOMException('cancelled', 'AbortError');
    return [choice];
  };
  window.showSaveFilePicker = async (options) => {
    saveId = options.id;
    return projectFile;
  };
  window.showDirectoryPicker = async (options) => {
    dirOptions = options ?? {};
    dirStartIn = options?.startIn;
    if (!dirAnswer) throw new DOMException('cancelled', 'AbortError');
    return dirAnswer;
  };
  const checkLocation = async (expected, message) => {
    if (!startIn || !await startIn.isSameEntry(expected)) throw new Error(message);
  };
  const waitFor = async (fn, message) => {
    for (let tries = 0; tries < 150; tries++) {
      const value = fn();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`timed out waiting for ${message}`);
  };
  const clickChooseFolder = async () => {
    const btn = await waitFor(
      () => [...document.querySelectorAll('.modal button')].find((b) => b.textContent?.includes('選擇資料夾')),
      '選擇資料夾 button',
    );
    dirOptions = undefined;
    dirStartIn = undefined;
    btn.click();
    await waitFor(() => dirOptions !== undefined, 'showDirectoryPicker call');
  };
  try {
    const first = await files.pickFileToOpen(project);
    if (first?.name !== recentFile.name) throw new Error('the selected file was not read');
    await checkLocation(project, 'first open must start at the project root');

    await files.pickSaveTarget('example.3dbx', project);
    if (saveId === openId) throw new Error('saving must have its own picker history');

    // Load a fresh module instance to verify the remembered location comes from IndexedDB.
    const reloadedUrl = new URL(filesUrl);
    reloadedUrl.searchParams.set('verify-open-location', String(Date.now()));
    const reloaded = await import(reloadedUrl.href);
    choice = null;
    if (await reloaded.pickFileToOpen(project) !== null) throw new Error('cancel must return null');
    await checkLocation(recentFile, 'the last open must take priority over the project root');
    await reloaded.pickFileToOpen(project);
    await checkLocation(recentFile, 'cancel must preserve the last open location');

    await storage.removeEntry(other.name, { recursive: true });
    await reloaded.pickFileToOpen(project);
    await checkLocation(project, 'a removed location must fall back to the project root');

    // Recreate the drawing file in `other` after removing `other` above.
    const other2 = await storage.getDirectoryHandle('open-recent', { create: true });
    const drawingFile2 = await other2.getFileHandle('sketch.3dbd', { create: true });
    const w2 = await drawingFile2.createWritable();
    await w2.write(drawingBytes);
    await w2.close();

    // A first open goes straight to the file picker with the browser's default location.
    const { __store: store } = window;
    Object.defineProperty(navigator.userActivation, 'isActive', { configurable: true, value: true });
    startIn = undefined;
    openId = undefined;
    store.open();
    await waitFor(() => store.getState().folderRequest || openId, 'file picker call');
    if (store.getState().folderRequest || !openId || startIn) throw new Error('first open must go directly to the file picker');
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Opening a drawing asks for the project folder; clicking 「選擇資料夾…」 must start in that file's parent folder.
    choice = drawingFile2;
    dirAnswer = project; // wrong folder first: dialog retries and must still keep the file's startIn
    store.open();
    await waitFor(() => store.getState().folderRequest, 'folder dialog for opened drawing');
    await clickChooseFolder();
    if (!dirStartIn || !(await dirStartIn.isSameEntry(drawingFile2))) {
      throw new Error('directory picker must start at the selected drawing file parent folder');
    }
    await waitFor(() => store.getState().folderRequest?.includes('不包含'), 'wrong-folder retry message');

    // Cancelling the OS directory picker keeps the dialog open; cancelling the dialog clears folderStartIn.
    dirAnswer = null;
    await clickChooseFolder();
    if (!dirStartIn || !(await dirStartIn.isSameEntry(drawingFile2))) {
      throw new Error('retrying folder picker must preserve the selected file startIn');
    }
    if (!store.getState().folderRequest) throw new Error('cancelling OS folder picker must keep folder dialog open');
    store.cancelFolder();
    await waitFor(() => !store.getState().folderRequest, 'folder dialog to close');

    // A subsequent unrelated folder prompt (e.g. new assembly with no open file) must not leak the prior file's startIn.
    store.newAssembly();
    await waitFor(() => store.getState().folderRequest, 'folder dialog for new assembly');
    await clickChooseFolder();
    if ('startIn' in dirOptions) throw new Error('unrelated folder dialog must not leak previous folderStartIn');
    store.cancelFolder();
    await waitFor(() => !store.getState().folderRequest, 'unrelated folder dialog to close');

    // Choosing the actual parent folder opens the drawing cleanly.
    dirAnswer = other2;
    store.open();
    await waitFor(() => store.getState().folderRequest, 'folder dialog for opening drawing');
    await clickChooseFolder();
    if (!dirStartIn || !(await dirStartIn.isSameEntry(drawingFile2))) {
      throw new Error('directory picker must start at drawingFile2 before opening');
    }
    await waitFor(() => !store.getState().folderRequest && store.getState().drw?.fileName === 'sketch.3dbd', 'drawing to open');
    return { ok: true };
  } finally {
    delete navigator.userActivation.isActive;
    window.showOpenFilePicker = originalOpen;
    window.showSaveFilePicker = originalSave;
    window.showDirectoryPicker = originalDir;
  }
} };
