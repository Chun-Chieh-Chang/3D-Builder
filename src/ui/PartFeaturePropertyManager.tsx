'use client';

import React from 'react';
import type { CADFeature } from '@/store/useCadStore';

export interface PartFeaturePropertyManagerProps {
  selectedFeature: CADFeature;
  features: CADFeature[];
  onParamChange: (key: string, value: any) => void;
  onEditSketch: (feature: CADFeature) => void;
  onSelectFeature: (id: string) => void;
  onBuildSweepLoft?: (feature: CADFeature) => void;
}

import { getParentsAndChildren } from '@/utils/feature-tree-relations';

export function PartFeaturePropertyManager({
  selectedFeature,
  features,
  onParamChange,
  onEditSketch,
  onSelectFeature,
  onBuildSweepLoft,
}: PartFeaturePropertyManagerProps) {
  const { parents, children } = getParentsAndChildren(selectedFeature, features);
  const relations = selectedFeature.parameters.relations as string[] | undefined;

  return (
    <div className="h-[250px] w-full border-t border-border bg-surface flex flex-col p-3 z-10 shrink-0">
      <div className="text-[14px] uppercase tracking-wider text-secondary-text mb-2 font-bold flex justify-between items-center border-b border-border/40 pb-1">
        <span>屬性管理器 (PropertyManager)</span>
        <span className="text-[13px] bg-primary/10 text-primary px-1 rounded uppercase font-mono">
          {selectedFeature.type}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
        {selectedFeature.type === 'PATTERN' ? (
          <div className="bg-surface p-3 rounded-xl border border-slate-200 shadow-sm space-y-4 text-[14px]">
            <div className="space-y-1.5">
              <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                目標特徵 (Features to Pattern)
              </span>
              <div className="space-y-2">
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const current = selectedFeature.parameters.target_feature_ids || [];
                    if (!current.includes(id)) {
                      onParamChange('target_feature_ids', [...current, id]);
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:border-[#005B9A] transition-colors"
                >
                  <option value="">+ 新增特徵...</option>
                  {features
                    .filter((f) => f.id !== selectedFeature.id && f.type !== 'PATTERN' && !(selectedFeature.parameters.target_feature_ids || []).includes(f.id))
                    .map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                </select>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedFeature.parameters.target_feature_ids || []).length === 0 && !selectedFeature.parameters.target_feature_id && (
                    <div className="w-full py-3 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-400 text-[11px] italic">
                      未選取目標特徵
                    </div>
                  )}
                  {(selectedFeature.parameters.target_feature_ids || []).map((id: string) => {
                    const feat = features.find(f => f.id === id);
                    return (
                      <div key={id} className="bg-[#005B9A]/10 text-[#005B9A] text-[11px] font-bold px-2 py-1 rounded-md border border-[#005B9A]/20 flex items-center gap-1.5 group">
                        {feat?.name || id}
                        <button 
                          onClick={() => onParamChange('target_feature_ids', (selectedFeature.parameters.target_feature_ids || []).filter((tid: string) => tid !== id))} 
                          className="hover:text-red-500 transition-colors"
                        >×</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase">類型</label>
                <select
                  value={selectedFeature.parameters.pattern_type || 'LINEAR'}
                  onChange={(e) => onParamChange('pattern_type', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-[#005B9A]"
                >
                  <option value="LINEAR">線性 (Linear)</option>
                  <option value="CIRCULAR">環形 (Circular)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase">數量</label>
                <input
                  type="number"
                  value={selectedFeature.parameters.count || 2}
                  onChange={(e) => onParamChange('count', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-[#005B9A]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase">
                  {selectedFeature.parameters.pattern_type === 'CIRCULAR' ? '角度' : '間距'}
                </label>
                <input
                  type="number"
                  value={selectedFeature.parameters.spacing || 10}
                  onChange={(e) => onParamChange('spacing', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-[#005B9A]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase">基準軸</label>
                <select
                  value={selectedFeature.parameters.axis || 'X'}
                  onChange={(e) => onParamChange('axis', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-[#005B9A]"
                >
                  <option value="X">X 軸</option>
                  <option value="Y">Y 軸</option>
                  <option value="Z">Z 軸</option>
                </select>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-1.5">
              <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
                方向參照 (Direction Ref)
              </span>
              <div className="bg-slate-50 border border-slate-300 rounded-lg p-2 min-h-[40px] flex flex-wrap gap-1.5 items-center">
                {(selectedFeature.parameters.direction_refs || []).map((ref: any, idx: number) => (
                  <div key={ref.id || idx} className="bg-emerald-100 text-emerald-700 text-[11px] font-bold px-2 py-1 rounded-md border border-emerald-200 flex items-center gap-1.5">
                    Edge {idx + 1}
                    <button onClick={() => onParamChange('direction_refs', [])} className="hover:text-red-500 transition-colors">×</button>
                  </div>
                ))}
                {(selectedFeature.parameters.direction_refs || []).length === 0 && (
                  <span className="text-[11px] text-slate-400 italic px-1">選取邊緣以定義方向</span>
                )}
              </div>
            </div>
          </div>
        ) : selectedFeature.type === 'MIRROR' ? (
          <div className="bg-surface p-3 rounded-xl border border-slate-200 shadow-sm space-y-4 text-[14px]">
            <div className="space-y-1.5">
              <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20"/><path d="M3 7l6 5-6 5V7z"/><path d="M21 7l-6 5 6 5V7z"/></svg>
                目標特徵 (Features to Mirror)
              </span>
              <div className="space-y-2">
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const current = selectedFeature.parameters.target_feature_ids || [];
                    if (!current.includes(id)) {
                      onParamChange('target_feature_ids', [...current, id]);
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:border-[#005B9A] transition-colors"
                >
                  <option value="">+ 新增特徵...</option>
                  {features
                    .filter((f) => f.id !== selectedFeature.id && f.type !== 'MIRROR' && !(selectedFeature.parameters.target_feature_ids || []).includes(f.id))
                    .map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                </select>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedFeature.parameters.target_feature_ids || []).length === 0 && !selectedFeature.parameters.target_feature_id && (
                    <div className="w-full py-3 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-400 text-[11px] italic">
                      預設鏡射整體實體 (Mirror Body)
                    </div>
                  )}
                  {(selectedFeature.parameters.target_feature_ids || []).map((id: string) => {
                    const feat = features.find(f => f.id === id);
                    return (
                      <div key={id} className="bg-[#005B9A]/10 text-[#005B9A] text-[11px] font-bold px-2 py-1 rounded-md border border-[#005B9A]/20 flex items-center gap-1.5 group">
                        {feat?.name || id}
                        <button 
                          onClick={() => onParamChange('target_feature_ids', (selectedFeature.parameters.target_feature_ids || []).filter((tid: string) => tid !== id))} 
                          className="hover:text-red-500 transition-colors"
                        >×</button>
                      </div>
                    );
                  })}
                  {/* Legacy support display */}
                  {selectedFeature.parameters.target_feature_id && !(selectedFeature.parameters.target_feature_ids || []).includes(selectedFeature.parameters.target_feature_id) && (
                    <div className="bg-[#005B9A]/10 text-[#005B9A] text-[11px] font-bold px-2 py-1 rounded-md border border-[#005B9A]/20 flex items-center gap-1.5">
                      {features.find(f => f.id === selectedFeature.parameters.target_feature_id)?.name || 'Legacy Target'}
                      <button onClick={() => onParamChange('target_feature_id', null)} className="hover:text-red-500">×</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-1.5">
              <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
                鏡射平面 (Mirror Plane)
              </span>
              <div className="bg-slate-50 border border-slate-300 rounded-lg p-2 min-h-[40px] flex flex-wrap gap-1.5 items-center">
                {(selectedFeature.parameters.mirror_plane_refs || []).map((ref: any, idx: number) => (
                  <div key={ref.id || idx} className="bg-amber-100 text-amber-700 text-[11px] font-bold px-2 py-1 rounded-md border border-amber-200 flex items-center gap-1.5">
                    {ref.type === 'FACE' ? 'Face' : (ref.id || 'Plane')}
                    <button onClick={() => onParamChange('mirror_plane_refs', [])} className="hover:text-red-500 transition-colors">×</button>
                  </div>
                ))}
                {(selectedFeature.parameters.mirror_plane_refs || []).length === 0 && (
                  <span className="text-[11px] text-slate-400 italic px-1">請選取 3D 視窗中的平面或面</span>
                )}
              </div>
            </div>
          </div>
        ) : selectedFeature.type === 'DRAFT' ? (
          <div className="bg-surface p-2 rounded border border-border shadow-sm space-y-2 text-[14px]">
            <label className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-secondary-text">拔模角 (度)</span>
              <input
                type="number"
                value={selectedFeature.parameters.angle ?? 5}
                onChange={(e) => onParamChange('angle', e.target.value)}
                className="border border-[#C4C7CE] rounded px-1.5 py-0.5 w-[80px] text-right font-mono"
              />
            </label>
            <div className="border-t border-border/50 pt-2 mt-2">
              <span className="text-[13px] text-secondary-text block mb-1">中立面 (Neutral Plane)</span>
              <div className="bg-white border border-[#C4C7CE] rounded p-1 min-h-[30px] flex flex-wrap gap-1">
                {(selectedFeature.parameters.neutral_plane_refs || []).map((ref: any, idx: number) => (
                  <div key={ref.id} className="bg-indigo-100 text-indigo-700 text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1">
                    Face {idx + 1}
                    <button onClick={() => onParamChange('neutral_plane_refs', [])} className="hover:text-red-500">×</button>
                  </div>
                ))}
                {(selectedFeature.parameters.neutral_plane_refs || []).length === 0 && (
                  <span className="text-[11px] text-slate-400 p-1 italic">點選基準面或平面作為拔模基準</span>
                )}
              </div>
            </div>
            <div className="border-t border-border/50 pt-2 mt-2">
              <span className="text-[13px] text-secondary-text block mb-1">拔模面 (Faces to Draft)</span>
              <div className="bg-white border border-[#C4C7CE] rounded p-1 min-h-[50px] flex flex-wrap gap-1 items-start content-start">
                {(selectedFeature.parameters.faces_to_draft_refs || []).map((ref: any, idx: number) => (
                  <div key={ref.id} className="bg-orange-100 text-orange-700 text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1">
                    Face {idx + 1}
                    <button onClick={() => onParamChange('faces_to_draft_refs', selectedFeature.parameters.faces_to_draft_refs.filter((r: any) => r.id !== ref.id))} className="hover:text-red-500">×</button>
                  </div>
                ))}
                {(selectedFeature.parameters.faces_to_draft_refs || []).length === 0 && (
                  <span className="text-[11px] text-slate-400 p-1 italic">點選要產生拔模角的側面</span>
                )}
              </div>
            </div>
          </div>
        ) : selectedFeature.type === 'SHELL' ? (
          <div className="bg-surface p-2 rounded border border-border shadow-sm space-y-2 text-[14px]">
            <label className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-secondary-text">厚度 (Thickness)</span>
              <input
                type="number"
                value={selectedFeature.parameters.thickness ?? 2}
                onChange={(e) => onParamChange('thickness', e.target.value)}
                className="border border-[#C4C7CE] rounded px-1.5 py-0.5 w-[80px] text-right font-mono"
              />
            </label>
            <div className="border-t border-border/50 pt-2 mt-2">
              <span className="text-[13px] text-secondary-text block mb-1">移除的面 (Faces to Remove)</span>
              <div className="bg-white border border-[#C4C7CE] rounded p-1 min-h-[50px] flex flex-wrap gap-1 items-start content-start">
                {(selectedFeature.parameters.faces_to_remove_refs || []).map((ref: any, idx: number) => (
                  <div key={ref.id} className="bg-teal-100 text-teal-700 text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1">
                    Face {idx + 1}
                    <button onClick={() => onParamChange('faces_to_remove_refs', selectedFeature.parameters.faces_to_remove_refs.filter((r: any) => r.id !== ref.id))} className="hover:text-red-500">×</button>
                  </div>
                ))}
                {(selectedFeature.parameters.faces_to_remove_refs || []).length === 0 && (
                  <span className="text-[11px] text-slate-400 p-1 italic">點選實體表面以將其移除/開口</span>
                )}
              </div>
            </div>
          </div>
        ) : selectedFeature.type === 'HOLE_WIZARD' ? (
          <div className="bg-surface p-2 rounded border border-border shadow-sm space-y-2 text-[14px]">
            <label className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-secondary-text">孔類型</span>
              <select
                value={selectedFeature.parameters.hole_type || 'SIMPLE'}
                onChange={(e) => onParamChange('hole_type', e.target.value)}
                className="border border-[#C4C7CE] rounded px-1 py-0.5 w-[120px]"
              >
                <option value="SIMPLE">直孔 (Simple)</option>
                <option value="COUNTERBORE">沉頭孔 (Counterbore)</option>
                <option value="COUNTERSINK">錐頭孔 (Countersink)</option>
              </select>
            </label>
            <div className="border-t border-border/50 pt-2 mt-2 space-y-2">
              <label className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-secondary-text">直徑</span>
                <input type="number" value={selectedFeature.parameters.diameter ?? 5} onChange={(e) => onParamChange('diameter', e.target.value)} className="border border-[#C4C7CE] rounded px-1.5 py-0.5 w-[80px] text-right font-mono" />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-secondary-text">深度</span>
                <input type="number" value={selectedFeature.parameters.depth ?? 10} onChange={(e) => onParamChange('depth', e.target.value)} className="border border-[#C4C7CE] rounded px-1.5 py-0.5 w-[80px] text-right font-mono" />
              </label>
              
              {selectedFeature.parameters.hole_type === 'COUNTERBORE' && (
                <>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-secondary-text">沉頭直徑</span>
                    <input type="number" value={selectedFeature.parameters.cb_diameter ?? 10} onChange={(e) => onParamChange('cb_diameter', e.target.value)} className="border border-[#C4C7CE] rounded px-1.5 py-0.5 w-[80px] text-right font-mono" />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-secondary-text">沉頭深度</span>
                    <input type="number" value={selectedFeature.parameters.cb_depth ?? 5} onChange={(e) => onParamChange('cb_depth', e.target.value)} className="border border-[#C4C7CE] rounded px-1.5 py-0.5 w-[80px] text-right font-mono" />
                  </label>
                </>
              )}

              {selectedFeature.parameters.hole_type === 'COUNTERSINK' && (
                <>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-secondary-text">錐頭直徑</span>
                    <input type="number" value={selectedFeature.parameters.cs_diameter ?? 10} onChange={(e) => onParamChange('cs_diameter', e.target.value)} className="border border-[#C4C7CE] rounded px-1.5 py-0.5 w-[80px] text-right font-mono" />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-secondary-text">錐角度數</span>
                    <input type="number" value={selectedFeature.parameters.cs_angle ?? 90} onChange={(e) => onParamChange('cs_angle', e.target.value)} className="border border-[#C4C7CE] rounded px-1.5 py-0.5 w-[80px] text-right font-mono" />
                  </label>
                </>
              )}
            </div>
            
            <div className="border-t border-border/50 pt-2 mt-2">
              <span className="text-[13px] text-secondary-text block mb-1">孔位 (Position)</span>
              <div className="bg-white border border-[#C4C7CE] rounded p-1 min-h-[30px] flex flex-wrap gap-1">
                {(selectedFeature.parameters.hole_placement_refs || []).map((ref: any, idx: number) => (
                  <div key={ref.id} className="bg-teal-100 text-teal-700 text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1">
                    Face Point
                    <button onClick={() => onParamChange('hole_placement_refs', [])} className="hover:text-red-500">×</button>
                  </div>
                ))}
                {(selectedFeature.parameters.hole_placement_refs || []).length === 0 && (
                  <span className="text-[11px] text-slate-400 p-1 italic">在 3D 視窗中點擊欲打孔的位置</span>
                )}
              </div>
            </div>
          </div>
        ) : selectedFeature.type === 'EXTRUDE' ? (
          <div className="space-y-2">
            <div className="bg-surface p-0 rounded border border-border shadow-sm overflow-hidden text-[14px]">
              <div className="bg-slate-50 px-2 py-1.5 border-b border-border font-bold text-slate-700 text-[13px] flex items-center gap-1">
                <span className="text-[14px]">▼</span> 操作 (Operation)
              </div>
              <div className="p-2">
                <select
                  value={selectedFeature.parameters.operation || 'ADD'}
                  onChange={(e) => onParamChange('operation', e.target.value)}
                  className="border border-[#C4C7CE] rounded px-1 py-1 w-full"
                >
                  <option value="ADD">加入 (Boss)</option>
                  <option value="CUT">切除 (Cut)</option>
                </select>
              </div>
            </div>
            
            <div className="bg-surface p-0 rounded border border-border shadow-sm overflow-hidden text-[14px]">
              <div className="bg-slate-50 px-2 py-1.5 border-b border-border font-bold text-slate-700 text-[13px] flex items-center gap-1">
                <span className="text-[14px]">▼</span> 方向 1 (Direction 1)
              </div>
              <div className="p-2 space-y-2">
                <select
                  value="BLIND"
                  disabled
                  className="border border-[#C4C7CE] rounded px-1 py-1 w-full bg-slate-50 text-slate-500"
                >
                  <option value="BLIND">給定深度 (Blind)</option>
                </select>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[20px] text-slate-400" title="深度">↕</span>
                  <div className="relative flex-1">
                    <input
                      type="number"
                      value={selectedFeature.parameters.depth || 10}
                      onChange={(e) => onParamChange('depth', e.target.value)}
                      className="border border-[#C4C7CE] rounded px-2 py-1 w-full text-right font-mono"
                    />
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-slate-400">D1</span>
                  </div>
                  <span className="text-[12px] text-slate-500">mm</span>
                </div>
              </div>
            </div>
          </div>
        ) : selectedFeature.type === 'DUMB_SOLID' ? (
          <div className="space-y-2">
            <div className="bg-surface p-0 rounded border border-border shadow-sm overflow-hidden text-[14px]">
              <div className="bg-slate-50 px-2 py-1.5 border-b border-border font-bold text-slate-700 text-[13px] flex items-center gap-1">
                <span className="text-[14px]">▼</span> 平移定位 (Translation)
              </div>
              <div className="p-2 space-y-2">
                {['x', 'y', 'z'].map(axis => (
                  <div key={axis} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-slate-500 uppercase">{axis}</span>
                    <div className="relative flex-1">
                      <input
                        type="number"
                        value={selectedFeature.parameters[axis] || 0}
                        onChange={(e) => onParamChange(axis, e.target.value)}
                        className="border border-[#C4C7CE] rounded px-2 py-1 w-full text-right font-mono"
                      />
                    </div>
                    <span className="text-[12px] text-slate-500">mm</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-surface p-0 rounded border border-border shadow-sm overflow-hidden text-[14px]">
              <div className="bg-slate-50 px-2 py-1.5 border-b border-border font-bold text-slate-700 text-[13px] flex items-center gap-1">
                <span className="text-[14px]">▼</span> 檔案資訊 (File Info)
              </div>
              <div className="p-2">
                <div className="text-[11px] text-slate-500 break-all font-mono">
                  {selectedFeature.parameters.filepath}
                </div>
              </div>
            </div>
          </div>
        ) : selectedFeature.type === 'FILLET' || selectedFeature.type === 'CHAMFER' ? (
          <div className="space-y-2">
            <div className="bg-surface p-0 rounded border border-border shadow-sm overflow-hidden text-[14px]">
              <div className="bg-slate-50 px-2 py-1.5 border-b border-border font-bold text-slate-700 text-[13px] flex items-center gap-1">
                <span className="text-[14px]">▼</span> 參數 (Parameters)
              </div>
              <div className="p-2 space-y-2">
                {/* R1 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[20px] text-slate-400" title={selectedFeature.type === 'FILLET' ? '起點半徑' : '距離'}>
                    {selectedFeature.type === 'FILLET' ? 'R1' : 'D1'}
                  </span>
                  <div className="relative flex-1">
                    <input
                      type="number"
                      value={selectedFeature.parameters[selectedFeature.type === 'FILLET' ? 'radius' : 'distance'] || 2}
                      onChange={(e) => onParamChange(selectedFeature.type === 'FILLET' ? 'radius' : 'distance', e.target.value)}
                      className="border border-[#C4C7CE] rounded px-2 py-1 w-full text-right font-mono"
                    />
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-slate-400">
                      {selectedFeature.type === 'FILLET' ? 'R1' : 'D1'}
                    </span>
                  </div>
                  <span className="text-[12px] text-slate-500">mm</span>
                </div>
                
                {/* R2 (Only for Fillet) */}
                {selectedFeature.type === 'FILLET' && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[20px] text-slate-400" title="終點半徑">
                      R2
                    </span>
                    <div className="relative flex-1">
                      <input
                        type="number"
                        value={selectedFeature.parameters.radius2 || 2}
                        onChange={(e) => onParamChange('radius2', e.target.value)}
                        className="border border-[#C4C7CE] rounded px-2 py-1 w-full text-right font-mono"
                      />
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-slate-400">
                        R2
                      </span>
                    </div>
                    <span className="text-[12px] text-slate-500">mm</span>
                  </div>
                )}
                
                {/* Selected Edges */}
                <div className="mt-3">
                  <div className="text-[12px] text-slate-500 mb-1 font-bold">已選取的邊緣 (Edges)</div>
                  <div className="border border-[#C4C7CE] rounded bg-white min-h-[40px] max-h-[80px] overflow-y-auto p-1">
                    {(selectedFeature.parameters.refs || []).length === 0 ? (
                      <div className="text-[11px] text-slate-400 italic p-1">在 3D 視圖中點擊邊緣...</div>
                    ) : (
                      (selectedFeature.parameters.refs || []).map((ref: any, idx: number) => (
                        <div key={ref.id || idx} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5 mb-1 text-[11px]">
                          <span className="text-blue-700 truncate font-mono">Edge {idx + 1}</span>
                          <button 
                            onClick={() => {
                              const newRefs = selectedFeature.parameters.refs.filter((r: any) => r.id !== ref.id);
                              onParamChange('refs', newRefs as any);
                            }}
                            className="text-red-500 hover:text-red-700"
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                
                {/* Tangent Propagation Option */}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="tangentProp"
                    checked={selectedFeature.parameters.tangentPropagation !== false} // default true
                    onChange={(e) => onParamChange('tangentPropagation', e.target.checked)}
                    className="w-3.5 h-3.5 cursor-pointer"
                  />
                  <label htmlFor="tangentProp" className="text-[12px] text-slate-600 cursor-pointer select-none">
                    相切傳遞 (Tangent Propagation)
                  </label>
                </div>
                
                <button
                  onClick={() => {
                    if (onBuildSweepLoft) {
                      onBuildSweepLoft(selectedFeature); // Use the same handler to trigger rebuild
                    }
                  }}
                  className="mt-3 w-full py-1.5 bg-[#005B9A] text-white text-[12px] font-bold rounded hover:bg-[#0073C1] transition-colors"
                >
                  ▶ Build {selectedFeature.type === 'FILLET' ? 'Fillet' : 'Chamfer'}
                </button>
              </div>
            </div>
          </div>
        ) : selectedFeature.type === 'THICKEN' || selectedFeature.type === 'SHELL' ? (
          <div className="space-y-2">
            <div className="bg-surface p-0 rounded border border-border shadow-sm overflow-hidden text-[14px]">
              <div className="bg-slate-50 px-2 py-1.5 border-b border-border font-bold text-slate-700 text-[13px] flex items-center gap-1">
                <span className="text-[14px]">▼</span> 參數 (Parameters)
              </div>
              <div className="p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[20px] text-slate-400" title="厚度">T</span>
                  <div className="relative flex-1">
                    <input
                      type="number"
                      value={selectedFeature.parameters.thickness || 1}
                      onChange={(e) => onParamChange('thickness', e.target.value)}
                      className="border border-[#C4C7CE] rounded px-2 py-1 w-full text-right font-mono"
                    />
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-slate-400">T1</span>
                  </div>
                  <span className="text-[12px] text-slate-500">mm</span>
                </div>
              </div>
            </div>
          </div>
        ) : selectedFeature.type === 'REVOLVE' ? (
          <div className="space-y-2">
            <div className="bg-surface p-0 rounded border border-border shadow-sm overflow-hidden text-[14px]">
              <div className="bg-slate-50 px-2 py-1.5 border-b border-border font-bold text-slate-700 text-[13px] flex items-center gap-1">
                <span className="text-[14px]">▼</span> 旋轉參數 (Revolve Parameters)
              </div>
              <div className="p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[20px] text-slate-400" title="角度">↻</span>
                  <div className="relative flex-1">
                    <input
                      type="number"
                      value={selectedFeature.parameters.angle || 360}
                      onChange={(e) => onParamChange('angle', e.target.value)}
                      className="border border-[#C4C7CE] rounded px-2 py-1 w-full text-right font-mono"
                    />
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-slate-400">A1</span>
                  </div>
                  <span className="text-[12px] text-slate-500">deg</span>
                </div>
              </div>
            </div>
          </div>
        ) : selectedFeature.type === 'SWEEP' ? (
          <div className="bg-surface p-3 rounded-xl border border-slate-200 shadow-sm space-y-4 text-[14px]">
            <div className="space-y-1.5">
              <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 22C4 13 14 13 14 4"/><circle cx="14" cy="4" r="2"/><circle cx="4" cy="22" r="2"/></svg>
                掃掠參數 (Sweep Parameters)
              </span>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[#005B9A] uppercase tracking-wider flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-full bg-[#005B9A]/10 border border-[#005B9A]/30 flex items-center justify-center text-[9px]">P</div>
                    輪廓 (Profile)
                  </label>
                  <select
                    value={selectedFeature.parameters.profile_id || ''}
                    onChange={(e) => onParamChange('profile_id', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:border-[#005B9A] transition-colors"
                  >
                    <option value="">— 請選取草圖 —</option>
                    {features.filter(f => f.type === 'SKETCH' && f.id !== selectedFeature.parameters.path_id).map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
                
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-full bg-emerald-600/10 border border-emerald-600/30 flex items-center justify-center text-[9px]">T</div>
                    路徑 (Path)
                  </label>
                  <select
                    value={selectedFeature.parameters.path_id || ''}
                    onChange={(e) => onParamChange('path_id', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:border-[#005B9A] transition-colors"
                  >
                    <option value="">— 請選取草圖 —</option>
                    {features.filter(f => f.type === 'SKETCH' && f.id !== selectedFeature.parameters.profile_id).map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            
            {onBuildSweepLoft && (
              <button
                onClick={() => onBuildSweepLoft(selectedFeature)}
                className={`mt-2 w-full py-2.5 text-white text-[13px] font-extrabold rounded-lg transition-all shadow-md flex items-center justify-center gap-2 ${
                  selectedFeature.parameters.profile_id && selectedFeature.parameters.path_id
                    ? 'bg-gradient-to-r from-[#005B9A] to-[#0073C1] hover:from-[#004A7C] hover:to-[#005B9A] cursor-pointer'
                    : 'bg-slate-300 cursor-not-allowed opacity-70'
                }`}
                disabled={!selectedFeature.parameters.profile_id || !selectedFeature.parameters.path_id}
              >
                ▶ 執行掃掠 (Build Sweep)
              </button>
            )}
          </div>
        ) : selectedFeature.type === 'LOFT' ? (
          <div className="bg-surface p-3 rounded-xl border border-slate-200 shadow-sm space-y-4 text-[14px]">
            <div className="space-y-1.5">
              <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 20h16"/><path d="M6 12h12"/><path d="M8 4h8"/><path d="M4 20L8 4"/><path d="M20 20L16 4"/></svg>
                疊層拉伸輪廓 (Loft Profiles)
              </span>
              <div className="space-y-2">
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const current = selectedFeature.parameters.profile_ids || [];
                    if (!current.includes(id)) {
                      onParamChange('profile_ids', [...current, id]);
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:border-[#005B9A] transition-colors"
                >
                  <option value="">+ 新增草圖輪廓...</option>
                  {features
                    .filter((f) => f.type === 'SKETCH' && !(selectedFeature.parameters.profile_ids || []).includes(f.id))
                    .map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                </select>
                <div className="flex flex-col gap-1.5">
                  {(selectedFeature.parameters.profile_ids || []).length === 0 && (
                    <div className="w-full py-3 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-400 text-[11px] italic">
                      請依序選取至少兩個草圖輪廓
                    </div>
                  )}
                  {(selectedFeature.parameters.profile_ids || []).map((id: string, index: number) => {
                    const feat = features.find(f => f.id === id);
                    return (
                      <div key={id} className="bg-[#005B9A]/10 text-[#005B9A] text-[11px] font-bold px-2 py-1.5 rounded-md border border-[#005B9A]/20 flex items-center justify-between group">
                        <div className="flex items-center gap-2">
                          <span className="w-4 h-4 rounded-full bg-[#005B9A] text-white flex items-center justify-center text-[9px]">{index + 1}</span>
                          {feat?.name || id}
                        </div>
                        <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                          <button 
                            disabled={index === 0}
                            onClick={() => {
                              const newIds = [...selectedFeature.parameters.profile_ids];
                              [newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]];
                              onParamChange('profile_ids', newIds);
                            }}
                            className="w-5 h-5 flex items-center justify-center hover:bg-slate-200 rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            title="上移"
                          >▲</button>
                          <button 
                            disabled={index === (selectedFeature.parameters.profile_ids || []).length - 1}
                            onClick={() => {
                              const newIds = [...selectedFeature.parameters.profile_ids];
                              [newIds[index + 1], newIds[index]] = [newIds[index], newIds[index + 1]];
                              onParamChange('profile_ids', newIds);
                            }}
                            className="w-5 h-5 flex items-center justify-center hover:bg-slate-200 rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            title="下移"
                          >▼</button>
                          <button 
                            onClick={() => onParamChange('profile_ids', (selectedFeature.parameters.profile_ids || []).filter((tid: string) => tid !== id))} 
                            className="w-5 h-5 flex items-center justify-center hover:bg-red-100 hover:text-red-600 rounded cursor-pointer text-slate-500"
                            title="移除"
                          >×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            
            {onBuildSweepLoft && (
              <button
                onClick={() => onBuildSweepLoft(selectedFeature)}
                className={`mt-2 w-full py-2.5 text-white text-[13px] font-extrabold rounded-lg transition-all shadow-md flex items-center justify-center gap-2 ${
                  (selectedFeature.parameters.profile_ids || []).length >= 2
                    ? 'bg-gradient-to-r from-[#005B9A] to-[#0073C1] hover:from-[#004A7C] hover:to-[#005B9A] cursor-pointer'
                    : 'bg-slate-300 cursor-not-allowed opacity-70'
                }`}
                disabled={(selectedFeature.parameters.profile_ids || []).length < 2}
              >
                ▶ 執行疊層拉伸 (Build Loft)
              </button>
            )}
          </div>
        ) : ['BOX', 'CYLINDER', 'SPHERE'].includes(selectedFeature.type) ? (
          <div className="space-y-2">
            <div className="bg-surface p-0 rounded border border-border shadow-sm overflow-hidden text-[14px]">
              <div className="bg-slate-50 px-2 py-1.5 border-b border-border font-bold text-slate-700 text-[13px] flex items-center gap-1">
                <span className="text-[14px]">▼</span> 尺寸 (Dimensions)
              </div>
              <div className="p-2 space-y-2">
                {['width', 'height', 'depth', 'radius'].map(dim => {
                  if (selectedFeature.parameters[dim] === undefined) return null;
                  return (
                    <div key={dim} className="flex items-center justify-between gap-2">
                      <span className="text-[13px] text-slate-500 uppercase w-12">{dim}</span>
                      <div className="relative flex-1">
                        <input
                          type="number"
                          value={selectedFeature.parameters[dim]}
                          onChange={(e) => onParamChange(dim, e.target.value)}
                          className="border border-[#C4C7CE] rounded px-2 py-1 w-full text-right font-mono"
                        />
                      </div>
                      <span className="text-[12px] text-slate-500">mm</span>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div className="bg-surface p-0 rounded border border-border shadow-sm overflow-hidden text-[14px]">
              <div className="bg-slate-50 px-2 py-1.5 border-b border-border font-bold text-slate-700 text-[13px] flex items-center gap-1">
                <span className="text-[14px]">▼</span> 平移定位 (Translation)
              </div>
              <div className="p-2 space-y-2">
                {['x', 'y', 'z'].map(axis => (
                  <div key={axis} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-slate-500 uppercase">{axis}</span>
                    <div className="relative flex-1">
                      <input
                        type="number"
                        value={selectedFeature.parameters[axis] || 0}
                        onChange={(e) => onParamChange(axis, e.target.value)}
                        className="border border-[#C4C7CE] rounded px-2 py-1 w-full text-right font-mono"
                      />
                    </div>
                    <span className="text-[12px] text-slate-500">mm</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-surface p-2 rounded border border-border shadow-sm space-y-2 text-[14px]">
            <div className="text-[13px] text-primary font-bold uppercase mb-1">參數</div>
            {Object.keys(selectedFeature.parameters).map((key) => {
              if (
                key === 'points' ||
                key === 'relations' ||
                key === 'faceOrigin' ||
                key === 'faceNormal' ||
                key === 'faceId' ||
                key === 'operation' ||
                key === 'plane' ||
                key === 'x' ||
                key === 'y' ||
                key === 'z'
              ) {
                return null;
              }
              const val = selectedFeature.parameters[key];
              return (
                <label key={key} className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-secondary-text uppercase">{key}</span>
                  <input
                    type="number"
                    value={val}
                    onChange={(e) => onParamChange(key, e.target.value)}
                    className="border border-[#C4C7CE] rounded px-1.5 py-0.5 w-[120px] text-right font-mono"
                  />
                </label>
              );
            })}
          </div>
        )}

        {relations && relations.length > 0 && (
          <div className="bg-surface p-2.5 rounded border border-border shadow-sm">
            <div className="text-[13px] font-bold uppercase mb-1">草圖關係</div>
            <div className="space-y-1 max-h-[85px] overflow-y-auto">
              {relations.map((rel, i) => (
                <div key={i} className="text-[13px] font-mono bg-slate-50 px-1.5 py-0.5 rounded border">
                  {rel}
                </div>
              ))}
            </div>
          </div>
        )}

        {(parents.length > 0 || children.length > 0) && (
          <div className="bg-surface p-2.5 rounded border border-border shadow-sm">
            <div className="text-[13px] font-bold uppercase mb-2">父子關係</div>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div>
                <div className="text-slate-500 mb-1">父項</div>
                {parents.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      p.type === 'SKETCH' ? onEditSketch(selectedFeature) : onSelectFeature(p.id)
                    }
                    className="w-full text-left mb-1 px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <div>
                <div className="text-slate-500 mb-1">子項</div>
                {children.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelectFeature(c.id)}
                    className="w-full text-left mb-1 px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-800"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
