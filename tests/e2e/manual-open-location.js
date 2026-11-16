// await __openLocation.run();
// Use real browser file handles and IndexedDB. Only the system dialog is substituted.
const filesUrl = performance.getEntriesByType('resource').map((e) => e.name).find((url) => new URL(url).pathname.endsWith('/src/files.ts'));
const files = await import(filesUrl);

window.__openLocation = { run: async () => {
  const storage = await navigator.storage.getDirectory();
  const project = await storage.getDirectoryHandle('open-project', { create: true });
  const other = await storage.getDirectoryHandle('open-recent', { create: true });
  const recentFile = await other.getFileHandle('recent.3dbx', { create: true });
  const projectFile = await project.getFileHandle('example.3dbx', { create: true });
  const originalOpen = window.showOpenFilePicker;
  const originalSave = window.showSaveFilePicker;
  let startIn;
  let openId;
  let saveId;
  let choice = recentFile;
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
  const checkLocation = async (expected, message) => {
    if (!startIn || !await startIn.isSameEntry(expected)) throw new Error(message);
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
    return { ok: true };
  } finally {
    window.showOpenFilePicker = originalOpen;
    window.showSaveFilePicker = originalSave;
  }
} };
