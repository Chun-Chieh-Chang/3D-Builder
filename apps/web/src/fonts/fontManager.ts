import { matchesPresetFont, readTrueType, type PresetFontId, type TrueTypeFont } from '@3db/drawing';

/**
 * Manages loading and caching of TrueType fonts for PDF export.
 * Provides a unified font pipeline for:
 * 1. Preset Chinese styles: 'sans', 'kai', 'serif', 'fangsong'
 * 2. Chromium Local Font Access API (window.queryLocalFonts)
 * 3. Windows / OS system fonts when running under Node or desktop
 * 4. Lazy-loading web fonts from local static or CDN
 * 5. In-memory custom font registration
 */
export class FontManager {
  private cache = new Map<string, TrueTypeFont>();
  private localFontsQueried = false;
  private localFontList: any[] | null = null;

  /** Clear cached fonts */
  clear(): void {
    this.cache.clear();
  }

  /** Cache a font manually (e.g. from user file picker or test) */
  set(key: string, font: TrueTypeFont): void {
    this.cache.set(key, font);
  }

  /** Retrieve a cached font directly */
  get(key: string): TrueTypeFont | undefined {
    return this.cache.get(key);
  }

  /**
   * Resolves a TrueTypeFont for the given font identifier.
   * If fontId is a preset ('sans', 'kai', 'serif', 'fangsong'), attempts to load:
   * 1. Memory cache
   * 2. Browser Local Font Access API
   * 3. Local OS Fonts (Windows Fonts folder)
   * 4. Web Fetch
   */
  async resolveFont(fontId: string): Promise<TrueTypeFont | null> {
    if (!fontId) return null;
    if (this.cache.has(fontId)) return this.cache.get(fontId)!;

    if (fontId === 'sans' || fontId === 'kai' || fontId === 'serif' || fontId === 'fangsong') {
      const font = await this.loadPresetFont(fontId);
      if (font) {
        this.cache.set(fontId, font);
        return font;
      }
    }

    return null;
  }

  private async loadPresetFont(presetId: PresetFontId): Promise<TrueTypeFont | null> {
    // 1. Try Browser Local Font Access API (Chromium Chrome/Edge)
    if (typeof window !== 'undefined' && 'queryLocalFonts' in window) {
      try {
        if (!this.localFontsQueried) {
          this.localFontList = await (window as any).queryLocalFonts();
          this.localFontsQueried = true;
        }
        if (this.localFontList && this.localFontList.length > 0) {
          const match = this.localFontList.find((f: any) =>
            matchesPresetFont(f.fullName ?? '', presetId) || matchesPresetFont(f.family ?? '', presetId)
          );
          if (match) {
            const blob = await match.blob();
            const buffer = await blob.arrayBuffer();
            const font = readTrueType(new Uint8Array(buffer));
            if (font.embeddable) return font;
          }
        }
      } catch {
        // User denied permission or error occurred: fallback to next strategy
      }
    }

    // 2. Try Node.js / Local filesystem if available (e.g. Windows test / desktop environment)
    if (typeof process !== 'undefined' && process.platform === 'win32') {
      try {
        const { existsSync, readFileSync } = await import('fs');
        const winPaths: Record<PresetFontId, string[]> = {
          sans: ['C:/Windows/Fonts/msjh.ttc', 'C:/Windows/Fonts/msjh.ttf', 'C:/Windows/Fonts/msyh.ttc'],
          kai: ['C:/Windows/Fonts/kaiu.ttf', 'C:/Windows/Fonts/simkai.ttf'],
          serif: ['C:/Windows/Fonts/mingliu.ttc', 'C:/Windows/Fonts/simsun.ttc'],
          fangsong: ['C:/Windows/Fonts/simfang.ttf', 'C:/Windows/Fonts/hyswlongfangsong.ttf'],
        };
        const candidates = winPaths[presetId] ?? [];
        for (const p of candidates) {
          if (existsSync(p)) {
            const bytes = new Uint8Array(readFileSync(p));
            const font = readTrueType(bytes);
            if (font.embeddable) return font;
          }
        }
      } catch {
        // fs import or read error: ignore
      }
    }

    // 3. Try fetching from public/fonts or CDN with timeout
    if (typeof fetch === 'function') {
      const fontUrls: Record<PresetFontId, string[]> = {
        sans: ['/fonts/NotoSansTC-Regular.ttf', 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf'],
        kai: ['/fonts/LXGWWenKai-Regular.ttf', 'https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@main/fonts/TTF/LXGWWenKai-Regular.ttf'],
        serif: ['/fonts/NotoSerifTC-Regular.ttf', 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notoseriftc/NotoSerifTC%5Bwght%5D.ttf'],
        fangsong: ['/fonts/FangSong.ttf'],
      };
      const urls = fontUrls[presetId] ?? [];
      for (const url of urls) {
        try {
          const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const tid = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
          const res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
          if (tid) clearTimeout(tid);
          if (res.ok) {
            const buffer = await res.arrayBuffer();
            const font = readTrueType(new Uint8Array(buffer));
            if (font.embeddable) return font;
          }
        } catch {
          // Next URL
        }
      }
    }

    return null;
  }
}

export const fontManager = new FontManager();
