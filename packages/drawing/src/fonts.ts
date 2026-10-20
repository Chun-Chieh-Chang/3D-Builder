/**
 * Preset Chinese font options for drawing PDF export.
 * Four standard engineering drawing styles:
 * 1. 'sans': Sans-serif / Gothic (CNS/ISO standard) - Microsoft JhengHei / Noto Sans TC / PingFang TC
 * 2. 'kai': Regular script / Kai - DFKai-SB / LXGW WenKai / Kaiti TC
 * 3. 'serif': Serif / Song / Ming - MingLiU / Noto Serif TC / Songti TC
 * 4. 'fangsong': FangSong (Engineering standard) - FangSong / STFangsong
 */

export type PresetFontId = 'sans' | 'kai' | 'serif' | 'fangsong';

export interface PresetFontDefinition {
  id: PresetFontId;
  /** System font family or font names to look for when accessing OS installed fonts (ordered by preference). */
  systemNames: readonly string[];
}

export const PRESET_FONTS: Record<PresetFontId, PresetFontDefinition> = {
  sans: {
    id: 'sans',
    systemNames: [
      'Microsoft JhengHei',
      '\u5FAE\u8EDF\u6B63\u9ED1\u9AD4', // 微軟正黑體
      'PingFang TC',
      '\u860B\u65B9-\u7E41', // 蘋方-繁
      'Noto Sans TC',
      'Noto Sans CJK TC',
      'Heiti TC',
      '\u9ED1\u9AD4-\u7E41', // 黑體-繁
      'Microsoft YaHei',
      '\u5FAE\u8F6F\u96C5\u9ED1', // 微軟雅黑
      'SimHei',
    ],
  },
  kai: {
    id: 'kai',
    systemNames: [
      'DFKai-SB',
      '\u6A19\u6977\u9AD4', // 標楷體
      'BiauKai',
      'Kaiti TC',
      '\u6977\u9AD4-\u7E41', // 楷體-繁
      'KaiTi',
      '\u6977\u4F53', // 楷體
      'LXGW WenKai',
      '\u971E\u9DA9\u6587\u6977', // 霞鶩文楷
    ],
  },
  serif: {
    id: 'serif',
    systemNames: [
      'MingLiU',
      '\u65B0\u7D30\u660E\u9AD4', // 新細明體
      'PMingLiU',
      'Songti TC',
      '\u5B8B\u9AD4-\u7E41', // 宋體-繁
      'Noto Serif TC',
      'Noto Serif CJK TC',
      'SimSun',
      '\u5B8B\u4F53', // 宋體
    ],
  },
  fangsong: {
    id: 'fangsong',
    systemNames: [
      'FangSong',
      '\u4EFF\u5B8B', // 仿宋
      'STFangsong',
      '\u834E\u6587\u4EFF\u5B8B', // 華文仿宋
      'SimFang',
    ],
  },
};

/** Checks if a font name or family matches any of the candidate names for a preset font. */
export function matchesPresetFont(fontName: string, presetId: PresetFontId): boolean {
  const norm = fontName.trim().toLowerCase();
  return PRESET_FONTS[presetId].systemNames.some((cand) => {
    const c = cand.toLowerCase();
    return norm === c || norm.includes(c) || c.includes(norm);
  });
}
