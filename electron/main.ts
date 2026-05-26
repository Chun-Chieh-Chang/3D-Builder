/**
 * Electron Main Process
 * 這是 Electron 桌面應用的主進程，負責：
 * 1. 建立應用程式視窗
 * 2. 管理應用程式生命週期
 * 3. 處理原生 API (檔案系統、對話框等)
 * 4. IPC 通訊 (與 Renderer Process 通訊)
 */

import { app, BrowserWindow, ipcMain, dialog, shell, IpcMainInvokeEvent, globalShortcut, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

// 檢查是否為開發模式
const isDev = !app.isPackaged && (process.argv.includes('--dev') || !fs.existsSync(path.join(__dirname, '../out/index.html')));

// 靜態檔案伺服器狀態
let staticServer: http.Server | null = null;
let serverPort = 0;

// 保存視窗引用，避免被垃圾回收
let mainWindow: BrowserWindow | null = null;

// Handle file open from command line
const getFilePathFromArgs = () => {
  if (process.platform === 'win32' && process.argv.length >= (isDev ? 2 : 1)) {
    const filePath = process.argv[isDev ? 2 : 1];
    if (filePath && fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
      return filePath;
    }
  }
  return null;
};

// 啟動本機靜態檔案伺服器，解決 file:// 協定絕對路徑失效問題
function startStaticServer(): Promise<number> {
  return new Promise((resolve) => {
    const publicDir = path.join(__dirname, '../out');
    staticServer = http.createServer((req, res) => {
      let safeUrl = req.url || '/';
      if (safeUrl.includes('..')) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }
      
      // 動態移除 basePath 前綴 "/3D-Builder" 確保 Electron 下靜態資源能正常載入
      if (safeUrl.startsWith('/3D-Builder/')) {
        safeUrl = safeUrl.substring('/3D-Builder'.length);
      } else if (safeUrl === '/3D-Builder') {
        safeUrl = '/';
      }
      
      // 移除 query 參數以定位實體檔案
      let filePath = path.join(publicDir, safeUrl.split('?')[0]);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }
        
        // 解析常見 Mime-Types，確保 CSS 與 JS 能被渲染進程正確讀取與執行
        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'text/html';
        if (ext === '.js') contentType = 'application/javascript';
        else if (ext === '.css') contentType = 'text/css';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.svg') contentType = 'image/svg+xml';
        else if (ext === '.json') contentType = 'application/json';
        else if (ext === '.ico') contentType = 'image/x-icon';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
    
    // 使用連接埠 0 讓作業系統自動分配空閒埠，100% 避免埠口碰撞
    staticServer.listen(0, '127.0.0.1', () => {
      const addr = staticServer?.address();
      if (addr && typeof addr !== 'string') {
        serverPort = addr.port;
        resolve(addr.port);
      } else {
        serverPort = 3010;
        resolve(3010);
      }
    });
  });
}

// 建立視窗
function createWindow() {
  // 建立瀏覽器視窗
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#EBEBEB', // SolidWorks 淺色主題
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
      sandbox: true,
    },
    icon: path.join(__dirname, '../assets/icon.ico'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
  });

  // 載入應用程式
  if (isDev) {
    // 開發模式：載入 Next.js 開發伺服器
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // 生產模式：載入本地靜態伺服器 (避開 file:// 協定問題)
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  }

  // 視窗關閉事件
    mainWindow.webContents.on('did-finish-load', () => {
    const filePath = getFilePathFromArgs();
    if (filePath) {
      mainWindow?.webContents.send('file:open-path', filePath);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 檔案系統操作 IPC handlers
ipcMain.handle('file:open', async (event: IpcMainInvokeEvent) => {
  const result = (await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: '3D-Builder Part Files', extensions: ['3dbpart'] },
      { name: 'Standard CAD Exchange Files', extensions: ['step', 'stp', 'stl', 'iges', 'igs'] },
      { name: 'SolidWorks Native Files (unsupported; convert to STEP first)', extensions: ['sldprt', 'sldasm'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })) as any;

  if (!result.canceled && result.filePaths.length > 0) {
    return { path: result.filePaths[0] };
  }
  return null;
});

ipcMain.handle('file:save', async (event: IpcMainInvokeEvent, data: string, options?: { format?: '3DBPART' | 'STEP' | 'IGES' | 'STL' }) => {
  const format = options?.format ?? '3DBPART';
  const saveFilters = {
    '3DBPART': [{ name: '3D-Builder Part Files', extensions: ['3dbpart'] }],
    'STEP': [{ name: 'STEP Files', extensions: ['step', 'stp'] }],
    'IGES': [{ name: 'IGES Files', extensions: ['iges', 'igs'] }],
    'STL': [{ name: 'STL Files', extensions: ['stl'] }],
  }[format];

  const result = (await dialog.showSaveDialog(mainWindow!, {
    defaultPath: format === '3DBPART' ? 'part.3dbpart' : `part.${format.toLowerCase()}`,
    filters: [
      ...saveFilters,
      { name: 'All Files', extensions: ['*'] },
    ],
  })) as any;

  if (!result.canceled && result.filePath) {
    try {
      await fs.promises.writeFile(result.filePath, data);
      return { success: true, path: result.filePath };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  return null;
});

ipcMain.handle('file:read', async (event: IpcMainInvokeEvent, filePath: string) => {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('app:open-external', async (event: IpcMainInvokeEvent, url: string) => {
  await shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('file:print-to-pdf', async (event: IpcMainInvokeEvent, filepath?: string) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { success: false, error: 'Window not found' };
  
  let targetPath = filepath;
  if (!targetPath) {
    const result = (await dialog.showSaveDialog(win, {
      title: 'Export PDF Drawing',
      defaultPath: 'drawing.pdf',
      filters: [
        { name: 'PDF Documents', extensions: ['pdf'] },
      ],
    })) as any;
    if (!result || result.canceled || !result.filePath) {
      return { success: false, error: 'Cancelled' };
    }
    targetPath = result.filePath;
  }
  
  if (!targetPath) {
    return { success: false, error: 'No filepath selected' };
  }
  
  try {
    const data = await win.webContents.printToPDF({
      landscape: true,
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });
    await fs.promises.writeFile(targetPath, data);
    return { success: true, path: targetPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// 應用程式生命週期
app.whenReady().then(async () => {
  if (!isDev) {
    await startStaticServer();
  }
  createWindow();

  // Register Global Shortcuts
  globalShortcut.register('CommandOrControl+O', () => {
    ipcMain.emit('file:open', { sender: mainWindow?.webContents } as any);
  });

  globalShortcut.register('CommandOrControl+S', () => {
    mainWindow?.webContents.send('file:save-request');
  });

  globalShortcut.register('CommandOrControl+N', () => {
    mainWindow?.webContents.send('app:new-file');
  });

  app.on('activate', () => {
    // macOS: 點擊 dock 圖示時重新建立視窗
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 非 macOS: 所有視窗關閉時退出應用
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: 點擊 dock 圖示時重新建立視窗
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 清理資源
app.on('before-quit', () => {
  // 可以在這裡保存應用程式狀態
  if (staticServer) {
    staticServer.close();
  }
});
