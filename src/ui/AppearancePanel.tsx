'use client';

import React, { useMemo } from 'react';
import { useCadStore, type MaterialAppearance, DEFAULT_APPEARANCE } from '../store/useCadStore';

const PRESETS: MaterialAppearance[] = [
  { ...DEFAULT_APPEARANCE, id: 'preset-blue', name: '藍色 (預設)', color: '#60A5FA' },
  { ...DEFAULT_APPEARANCE, id: 'preset-red', name: '紅色', color: '#EF4444' },
  { ...DEFAULT_APPEARANCE, id: 'preset-green', name: '綠色', color: '#10B981' },
  { ...DEFAULT_APPEARANCE, id: 'preset-yellow', name: '黃色', color: '#F59E0B' },
  { ...DEFAULT_APPEARANCE, id: 'preset-purple', name: '紫色', color: '#8B5CF6' },
  { ...DEFAULT_APPEARANCE, id: 'preset-gray', name: '灰色', color: '#6B7280' },
  { ...DEFAULT_APPEARANCE, id: 'preset-metal', name: '金屬', color: '#9CA3AF', glossAmount: 0.8, reflectionAmount: 0.6 },
  { ...DEFAULT_APPEARANCE, id: 'preset-glass', name: '玻璃', color: '#93C5FD', transmissionAmount: 0.7, glossAmount: 0.9 },
];

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
}

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step = 0.01, onChange }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-[12px]">
      <span className="text-slate-600 font-bold">{label}</span>
      <span className="text-slate-500 font-mono">{value.toFixed(2)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary"
    />
  </div>
);

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
}

const ColorPicker: React.FC<ColorPickerProps> = ({ label, value, onChange }) => (
  <div className="space-y-1">
    <div className="text-[12px] text-slate-600 font-bold">{label}</div>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-10 rounded border border-slate-300 cursor-pointer"
      />
      <span className="text-[12px] font-mono text-slate-500">{value}</span>
    </div>
  </div>
);

export const AppearancePanel: React.FC = () => {
  const {
    selectedId,
    features,
    appearances,
    setFeatureAppearance,
    copyAppearance,
    pasteAppearance,
  } = useCadStore();

  const selectedFeature = useMemo(() => 
    features.find(f => f.id === selectedId), 
    [features, selectedId]
  );

  const currentAppearance = useMemo(() => 
    selectedId ? (appearances.features[selectedId] || DEFAULT_APPEARANCE) : DEFAULT_APPEARANCE,
    [selectedId, appearances.features]
  );

  const updateAppearance = (updates: Partial<MaterialAppearance>) => {
    if (selectedId) {
      setFeatureAppearance(selectedId, updates);
    }
  };

  if (!selectedId || !selectedFeature) {
    return (
      <div className="p-4 bg-white rounded-xl border border-[#D1D5DB] shadow-sm">
        <div className="text-center text-[13px] text-slate-500 py-8">
          請先選擇一個特徵以調整外觀
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 bg-white rounded-xl border border-[#D1D5DB] shadow-sm space-y-3">
      <div className="text-[14px] text-slate-700 font-bold uppercase border-b border-[#D1D5DB]/50 pb-1 flex justify-between items-center">
        <span className="flex items-center gap-1">🎨 外觀 (Appearances)</span>
        <span className="text-[13px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-mono">{selectedFeature.name}</span>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => updateAppearance({ color: preset.color, glossAmount: preset.glossAmount, reflectionAmount: preset.reflectionAmount, transmissionAmount: preset.transmissionAmount })}
            title={preset.name}
            className="aspect-square rounded border-2 transition-all hover:scale-105"
            style={{ 
              backgroundColor: preset.color,
              borderColor: currentAppearance.color === preset.color ? '#3B82F6' : '#E5E7EB'
            }}
          />
        ))}
      </div>

      <div className="h-px bg-slate-200" />

      <ColorPicker
        label="顏色 (Color)"
        value={currentAppearance.color}
        onChange={(c) => updateAppearance({ color: c })}
      />

      <Slider
        label="擴散量 (Diffuse)"
        value={currentAppearance.diffuseAmount}
        min={0}
        max={1}
        onChange={(v) => updateAppearance({ diffuseAmount: v })}
      />

      <Slider
        label="光澤量 (Gloss)"
        value={currentAppearance.glossAmount}
        min={0}
        max={1}
        onChange={(v) => updateAppearance({ glossAmount: v })}
      />

      <Slider
        label="亮度 (Brightness)"
        value={currentAppearance.brightness}
        min={-1}
        max={1}
        onChange={(v) => updateAppearance({ brightness: v })}
      />

      <div className="h-px bg-slate-200" />

      <ColorPicker
        label="光澤顏色 (Gloss Color)"
        value={currentAppearance.glossColor}
        onChange={(c) => updateAppearance({ glossColor: c })}
      />

      <Slider
        label="光澤分佈 (Gloss Dist.)"
        value={currentAppearance.glossDistribution}
        min={0}
        max={1}
        onChange={(v) => updateAppearance({ glossDistribution: v })}
      />

      <Slider
        label="反射量 (Reflection)"
        value={currentAppearance.reflectionAmount}
        min={0}
        max={1}
        onChange={(v) => updateAppearance({ reflectionAmount: v })}
      />

      <Slider
        label="透射量 (Transmission)"
        value={currentAppearance.transmissionAmount}
        min={0}
        max={1}
        onChange={(v) => updateAppearance({ transmissionAmount: v })}
      />

      <Slider
        label="發光量 (Glow)"
        value={currentAppearance.glowAmount}
        min={0}
        max={1}
        onChange={(v) => updateAppearance({ glowAmount: v })}
      />

      <div className="h-px bg-slate-200" />

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => copyAppearance(currentAppearance)}
          className="flex items-center justify-center gap-1.5 p-2 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-slate-700 rounded border border-[#E2E8F0] text-[13px] font-bold transition-all"
        >
          📋 複製外觀
        </button>
        <button
          onClick={() => pasteAppearance('feature', selectedId)}
          disabled={!appearances.clipboard}
          className="flex items-center justify-center gap-1.5 p-2 bg-primary/10 hover:bg-primary/20 text-primary rounded border border-primary/30 text-[13px] font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          📄 貼上外觀
        </button>
      </div>
    </div>
  );
};
