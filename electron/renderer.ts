/**
 * Electron Renderer Process Integration
 */

import { IpcRendererEvent } from 'electron';

// File API
export const fileAPI = {
  open: async (): Promise<{ path: string } | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.file.open();
    }
    return null;
  },

  save: async (data: string): Promise<{ success: boolean; path?: string; error?: string } | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.file.save(data);
    }
    return null;
  },

  read: async (filePath: string): Promise<{ success: boolean; content?: string; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.file.read(filePath);
    }
    return { success: false, error: 'Electron API not available' };
  },

  printToPdf: async (filePath?: string): Promise<{ success: boolean; path?: string; error?: string }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.file.printToPdf(filePath);
    }
    return { success: false, error: 'Electron API not available' };
  },
};

// App API
export const appAPI = {
  openExternal: async (url: string): Promise<{ success: boolean }> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.app.openExternal(url);
    }
    return { success: false };
  },
  
  notify: async (title: string, body: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      await window.electronAPI.app.notify(title, body);
    }
  },
};

// Event Listeners
export const onFileOpen = (callback: (path: string) => void): (() => void) => {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI.onFileOpen(callback);
  }
  return () => {};
};

export const onSaveRequest = (callback: () => void): (() => void) => {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI.onSaveRequest(callback);
  }
  return () => {};
};

export const onNewFile = (callback: () => void): (() => void) => {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI.onNewFile(callback);
  }
  return () => {};
};

export const onMainProcessMessage = (
  callback: (event: IpcRendererEvent, data: any) => void
): (() => void) => {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI.onMainProcessMessage(callback);
  }
  return () => {};
};
