/**
 * Electron Preload Script
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Expose API to Renderer Process
contextBridge.exposeInMainWorld('electronAPI', {
  // File API
  file: {
    open: () => ipcRenderer.invoke('file:open'),
    save: (data: string) => ipcRenderer.invoke('file:save', data),
    read: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
    printToPdf: (filePath?: string) => ipcRenderer.invoke('file:print-to-pdf', filePath),
  },

  // App API
  app: {
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
    notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', title, body),
  },

  // Listeners for shortcuts and file associations
  onFileOpen: (callback: (path: string) => void) => {
    const listener = (_: any, path: string) => callback(path);
    ipcRenderer.on('file:open-path', listener);
    return () => ipcRenderer.off('file:open-path', listener);
  },
  onSaveRequest: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('file:save-request', listener);
    return () => ipcRenderer.off('file:save-request', listener);
  },
  onNewFile: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:new-file', listener);
    return () => ipcRenderer.off('app:new-file', listener);
  },

  // Generic messaging
  onMainProcessMessage: (callback: (event: IpcRendererEvent, data: any) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(_event, data);
    ipcRenderer.on('main-process-message', subscription);
    return () => {
      ipcRenderer.off('main-process-message', subscription);
    };
  },
});

// TypeScript Declaration
declare global {
  interface Window {
    electronAPI: {
      file: {
        open: () => Promise<{ path: string } | null>;
        save: (data: string) => Promise<{ success: boolean; path?: string; error?: string } | null>;
        read: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
        printToPdf: (filePath?: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      };
      app: {
        openExternal: (url: string) => Promise<{ success: boolean }>;
        notify: (title: string, body: string) => Promise<void>;
      };
      onFileOpen: (callback: (path: string) => void) => () => void;
      onSaveRequest: (callback: () => void) => () => void;
      onNewFile: (callback: () => void) => () => void;
      onMainProcessMessage: (callback: (event: IpcRendererEvent, data: any) => void) => () => void;
    };
  }
}
