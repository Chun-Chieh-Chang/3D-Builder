'use client';

import React from 'react';
import type { CADFeature, CadState } from '@/store/useCadStore';
import { useCadStore } from '@/store/useCadStore';
import { getParentsAndChildren } from '@/utils/feature-tree-relations';
import { Rollout } from './PropertyManager/Rollout';
import { SelectionBox } from './PropertyManager/SelectionBox';
import { PMHeader } from './PropertyManager/PMHeader';
import { EquationEngine } from '@/utils/EquationEngine';

const ParamInput: React.FC<{ 
  label: string; 
  value: any; 
  onChange: (val: any) => void; 
  unit?: string;
  badge?: string;
}> = ({ label, value, onChange, unit = 'mm', badge }) => {
  const { evaluatedVariables } = useCadStore();
  const isFormula = typeof value === 'string' && value.startsWith('=');
  const displayValue = isFormula ? value : value ?? 0;
  const evaluated = isFormula ? EquationEngine.evaluate(value.substring(1), evaluatedVariables) : Number(value);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold text-slate-500 uppercase">{label}</label>
        {isFormula && (
          <span className="text-[9px] font-black text-indigo-500 bg-indigo-50 px-1 rounded border border-indigo-100">
            PARAMETRIC
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={displayValue}
            onChange={(e) => {
              const val = e.target.value;
              if (val.startsWith('=')) onChange(val);
              else {
                const num = parseFloat(val);
                onChange(isNaN(num) ? 0 : num);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className={`w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] text-right font-mono font-bold transition-all focus:border-[#005B9A] focus:ring-1 focus:ring-[#005B9A]/20 outline-none ${isFormula ? 'text-indigo-700 border-indigo-200' : 'text-slate-800'}`}
          />
          {badge && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-black">{badge}</span>}
        </div>
        <span className="text-[11px] text-slate-500 font-bold w-6">{unit}</span>
      </div>
      {isFormula && (
        <div className="text-[10px] text-emerald-600 font-black text-right pr-8 animate-in fade-in">
          = {evaluated.toFixed(3)} {unit}
        </div>
      )}
    </div>
  );
};

export interface PartFeaturePropertyManagerProps {
  selectedFeature: CADFeature;
  features: CADFeature[];
  onParamChange: (key: string, value: any) => void;
  onEditSketch: (feature: CADFeature) => void;
  onSelectFeature: (id: string) => void;
  onBuildSweepLoft?: (feature: CADFeature) => void;
}

const HOLE_PRESETS: Record<string, { diameter: number; cb_diameter?: number; cb_depth?: number; cs_diameter?: number; cs_angle?: number }> = {
  'M3': { diameter: 3.4, cb_diameter: 6.0, cb_depth: 3.3, cs_diameter: 6.6, cs_angle: 90 },
  'M4': { diameter: 4.5, cb_diameter: 8.0, cb_depth: 4.4, cs_diameter: 8.6, cs_angle: 90 },
  'M5': { diameter: 5.5, cb_diameter: 10.0, cb_depth: 5.4, cs_diameter: 10.4, cs_angle: 90 },
  'M6': { diameter: 6.6, cb_diameter: 11.0, cb_depth: 6.5, cs_diameter: 12.6, cs_angle: 90 },
  'M8': { diameter: 9.0, cb_diameter: 15.0, cb_depth: 8.6, cs_diameter: 16.8, cs_angle: 90 },
};

export function PartFeaturePropertyManager({
  selectedFeature,
  features,
  onParamChange,
  onEditSketch,
  onSelectFeature,
  onBuildSweepLoft,
}: PartFeaturePropertyManagerProps) {
  const [pmTab, setPmTab] = React.useState<'FEATURE' | 'ADVANCED'>('FEATURE');
  const { parents, children } = getParentsAndChildren(selectedFeature, features);
  const updateFeatureProperty = useCadStore((state: CadState) => state.updateFeatureProperty);
  const setSelectedId = useCadStore((state: CadState) => state.setSelectedId);
  const pendingFeatureCommand = useCadStore((state: CadState) => state.pendingFeatureCommand);

  const handleConfirm = () => {
    if (onBuildSweepLoft && ['SWEEP', 'LOFT', 'HELICAL_SWEEP', 'FILLET', 'CHAMFER', 'SURFACE_OFFSET', 'SURFACE_KNIT', 'DOME'].includes(selectedFeature.type)) {
      onBuildSweepLoft(selectedFeature);
    }
    setSelectedId(null);
  };

  const handleCancel = () => {
    setSelectedId(null);
  };

  return (
    <div className="h-full w-full border-t border-slate-300 bg-[#F5F5F5] flex flex-col z-10 shrink-0 overflow-hidden">
      <PMHeader 
        title={`${selectedFeature.type} - ${selectedFeature.name}`} 
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
      
      {/* PropertyManager Tabs */}
      <div className="flex px-2 mb-1 border-b border-slate-200 bg-white">
        {['FEATURE', 'ADVANCED'].map((t) => (
          <button
            key={t}
            onClick={() => setPmTab(t as any)}
            className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-tighter border-b-2 transition-all ${
              pmTab === t ? 'border-[#005B9A] text-[#005B9A]' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1 custom-scrollbar">
        {pmTab === 'FEATURE' ? (
          <>
            {selectedFeature.type === 'SURFACE_OFFSET' && (
              <Rollout title="Surface Offset" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M16 14l4-4-4-4"/><path d="M20 10H4"/></svg>}>
                <div className="space-y-3">
                  <SelectionBox 
                    label="Faces to Offset" 
                    selectedCount={selectedFeature.parameters.refs?.length || 0} 
                    onClear={() => onParamChange('refs', [])}
                    active={pendingFeatureCommand === 'SURFACE_OFFSET'}
                    onClick={() => useCadStore.setState({ pendingFeatureCommand: 'SURFACE_OFFSET' })}
                  />
                  <ParamInput label="Offset Distance" value={selectedFeature.parameters.distance} onChange={(v) => onParamChange('distance', v)} badge="DIST" />
                </div>
              </Rollout>
            )}

            {selectedFeature.type === 'SURFACE_KNIT' && (
              <Rollout title="Knit Surface" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M16 3H8l-5 9 5 9h8l5-9-5-9z"/><path d="M12 3v18"/><path d="M3 12h18"/></svg>}>
                <div className="space-y-3">
                  <SelectionBox 
                    label="Surfaces to Knit" 
                    selectedCount={selectedFeature.parameters.refs?.length || 0} 
                    onClear={() => onParamChange('refs', [])}
                    active={pendingFeatureCommand === 'SURFACE_KNIT'}
                    onClick={() => useCadStore.setState({ pendingFeatureCommand: 'SURFACE_KNIT' })}
                  />
                  <div className="p-2 bg-indigo-50 border border-indigo-100 rounded text-[10px] text-indigo-700 font-bold">
                    Merge multiple surfaces into a single manifold body.
                  </div>
                </div>
              </Rollout>
            )}

            {selectedFeature.type === 'PATTERN' && (
              <>
                <Rollout title="Features to Pattern" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>}>
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
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                    >
                      <option value="">+ Add Feature...</option>
                      {features
                        .filter((f) => f.id !== selectedFeature.id && f.type !== 'PATTERN' && !(selectedFeature.parameters.target_feature_ids || []).includes(f.id))
                        .map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                    </select>

                    <SelectionBox 
                      label="Selected Features"
                      items={(selectedFeature.parameters.target_feature_ids || []).map((id: string) => ({ id, name: features.find(f => f.id === id)?.name || id }))}
                      onRemove={(id) => onParamChange('target_feature_ids', (selectedFeature.parameters.target_feature_ids || []).filter((tid: string) => tid !== id))}
                      onClear={() => onParamChange('target_feature_ids', [])}
                      placeholder="Select features from the tree or list"
                    />
                  </div>
                </Rollout>

                <Rollout title="Direction 1" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>}>
                  <div className="space-y-3">
                    <SelectionBox 
                      label="Pattern Direction"
                      items={(selectedFeature.parameters.direction_refs || []).map((ref: any, idx: number) => ({ id: ref.id || `${idx}`, name: `Edge ${idx + 1}` }))}
                      onRemove={() => onParamChange('direction_refs', [])}
                      onClear={() => onParamChange('direction_refs', [])}
                      placeholder="Select edge for direction"
                      maxHeight="60px"
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <ParamInput label="Spacing" value={selectedFeature.parameters.spacing} onChange={(v) => onParamChange('spacing', v)} />
                      <ParamInput label="Instances" value={selectedFeature.parameters.count} onChange={(v) => onParamChange('count', v)} unit="pcs" />
                    </div>
                  </div>
                </Rollout>

                <Rollout title="Pattern Type" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>}>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Method</label>
                      <select
                        value={selectedFeature.parameters.pattern_type || 'LINEAR'}
                        onChange={(e) => onParamChange('pattern_type', e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                      >
                        <option value="LINEAR">Linear Pattern</option>
                        <option value="CIRCULAR">Circular Pattern</option>
                      </select>
                    </div>

                    {selectedFeature.parameters.pattern_type === 'CIRCULAR' && (
                      <div className="space-y-3 animate-in fade-in slide-in-from-top-1">
                        <SelectionBox 
                          label="Rotation Axis"
                          items={selectedFeature.parameters.axis_edge_id ? [{ id: selectedFeature.parameters.axis_edge_id, name: `Axis (${selectedFeature.parameters.axis_edge_id.slice(0, 4)})` }] : []}
                          onRemove={() => onParamChange('axis_edge_id', null)}
                          onClear={() => onParamChange('axis_edge_id', null)}
                          placeholder="Select a center line or edge"
                          active={pendingFeatureCommand === 'PATTERN'}
                          onClick={() => useCadStore.setState({ pendingFeatureCommand: 'PATTERN' })}
                        />
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Equal Spacing</label>
                          <button 
                            onClick={() => onParamChange('equalSpacing', selectedFeature.parameters.equalSpacing === undefined ? true : !selectedFeature.parameters.equalSpacing)}
                            className={`px-3 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.equalSpacing !== false ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                          >
                            {selectedFeature.parameters.equalSpacing !== false ? 'ON' : 'OFF'}
                          </button>
                        </div>
                        <ParamInput label="Total Angle" value={selectedFeature.parameters.totalAngle || 360} onChange={(v) => onParamChange('totalAngle', v)} unit="deg" badge="∠" />
                      </div>
                    )}
                  </div>
                </Rollout>
              </>
            )}

            {selectedFeature.type === 'EXTRUDE' && (
              <>
                <Rollout title="From" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>}>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Start Condition</label>
                    <select 
                      value="SKETCH_PLANE" 
                      disabled 
                      className="w-full bg-[#F5F5F5] border border-slate-300 rounded px-2 py-1 text-[12px] text-slate-500"
                    >
                      <option value="SKETCH_PLANE">Sketch Plane</option>
                    </select>
                  </div>
                </Rollout>

                <Rollout title="Direction 1" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={selectedFeature.parameters.operation === 'CUT' ? 'CUT' : 'ADD'}
                        onChange={(e) => onParamChange('operation', e.target.value)}
                        className="flex-1 bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                      >
                        <option value="ADD">Boss/Base</option>
                        <option value="CUT">Cut</option>
                      </select>
                      <button 
                        onClick={() => onParamChange('flip', !selectedFeature.parameters.flip)}
                        className={`p-1 border rounded hover:bg-slate-100 transition-colors ${selectedFeature.parameters.flip ? 'bg-[#005B9A] border-[#004A7C] text-white' : 'border-slate-300 text-slate-600'}`}
                        title="Reverse Direction"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 11V7l-5 5 5 5v-4h10v4l5-5-5-5v4z"/></svg>
                      </button>
                    </div>

                    <div className="space-y-1 mt-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">End Condition</label>
                      <select
                        value={selectedFeature.parameters.endCondition || 'BLIND'}
                        onChange={(e) => {
                          onParamChange('endCondition', e.target.value);
                          if (e.target.value === 'THROUGH_ALL') {
                            onParamChange('depth', 9999); // Use an arbitrarily large depth for Through All
                          }
                        }}
                        className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                      >
                        <option value="BLIND">Blind</option>
                        <option value="THROUGH_ALL">Through All</option>
                        <option value="UP_TO_NEXT">Up To Next</option>
                        <option value="UP_TO_VERTEX">Up To Vertex</option>
                        <option value="UP_TO_SURFACE">Up To Surface</option>
                        <option value="OFFSET_FROM_SURFACE">Offset From Surface</option>
                        <option value="MID_PLANE">Mid Plane</option>
                      </select>
                    </div>

                    {((selectedFeature.parameters.endCondition || 'BLIND') === 'UP_TO_SURFACE' || (selectedFeature.parameters.endCondition || 'BLIND') === 'OFFSET_FROM_SURFACE') && (
                      <div className="space-y-2">
                        <SelectionBox 
                          label="Reference Face"
                          items={selectedFeature.parameters.upToSurfaceRef ? [{ id: selectedFeature.parameters.upToSurfaceRef.id, name: `Face ${selectedFeature.parameters.upToSurfaceRef.id.slice(0,4)}` }] : []}
                          onRemove={() => onParamChange('upToSurfaceRef', null)}
                          onClear={() => onParamChange('upToSurfaceRef', null)}
                          placeholder="Select a face from 3D view"
                          active={pendingFeatureCommand === 'EXTRUDE'}
                          onClick={() => useCadStore.setState({ pendingFeatureCommand: 'EXTRUDE' })}
                        />
                        {(selectedFeature.parameters.endCondition || 'BLIND') === 'OFFSET_FROM_SURFACE' && (
                          <ParamInput label="Offset" value={selectedFeature.parameters.offsetDistance || 0} onChange={(v) => onParamChange('offsetDistance', v)} badge="OFF" />
                        )}
                      </div>
                    )}

                    {(selectedFeature.parameters.endCondition || 'BLIND') === 'UP_TO_VERTEX' && (
                      <SelectionBox 
                        label="Reference Vertex"
                        items={selectedFeature.parameters.upToVertexRef ? [{ id: selectedFeature.parameters.upToVertexRef.id, name: `Vertex ${selectedFeature.parameters.upToVertexRef.id.slice(0,4)}` }] : []}
                        onRemove={() => onParamChange('upToVertexRef', null)}
                        onClear={() => onParamChange('upToVertexRef', null)}
                        placeholder="Select a vertex from 3D view"
                        active={pendingFeatureCommand === 'EXTRUDE'}
                        onClick={() => useCadStore.setState({ pendingFeatureCommand: 'EXTRUDE' })}
                      />
                    )}

                    {(selectedFeature.parameters.endCondition || 'BLIND') === 'BLIND' && (
                      <ParamInput label="Depth" value={selectedFeature.parameters.depth} onChange={(v) => onParamChange('depth', v)} badge="D1" />
                    )}

                    <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                       <button
                         onClick={() => onParamChange('isSurfaceOnly', !selectedFeature.parameters.isSurfaceOnly)}
                         className={`flex-1 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.isSurfaceOnly ? 'bg-orange-50 border-orange-400 text-orange-700' : 'bg-white border-slate-200 text-slate-400'}`}
                       >
                         {selectedFeature.parameters.isSurfaceOnly ? 'SURFACE MODE ON' : 'SOLID BOSS/BASE'}
                       </button>
                    </div>
                  </div>
                </Rollout>

                <Rollout title="Direction 2" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m19 12-7 7-7-7"/><path d="M12 5v14"/></svg>}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Enable Direction 2</label>
                      <button 
                        onClick={() => onParamChange('hasDirection2', !selectedFeature.parameters.hasDirection2)}
                        className={`px-3 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.hasDirection2 ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                      >
                        {selectedFeature.parameters.hasDirection2 ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    {selectedFeature.parameters.hasDirection2 && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                        <div className="space-y-1 mt-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">End Condition 2</label>
                          <select
                            value={selectedFeature.parameters.endCondition2 || 'BLIND'}
                            onChange={(e) => {
                              onParamChange('endCondition2', e.target.value);
                              if (e.target.value === 'THROUGH_ALL') {
                                onParamChange('depth2', 9999);
                              }
                            }}
                            className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                          >
                            <option value="BLIND">Blind</option>
                            <option value="THROUGH_ALL">Through All</option>
                          </select>
                        </div>
                        {(selectedFeature.parameters.endCondition2 || 'BLIND') === 'BLIND' && (
                          <ParamInput label="Depth 2" value={selectedFeature.parameters.depth2 || 10} onChange={(v) => onParamChange('depth2', v)} badge="D2" />
                        )}
                      </div>
                    )}
                  </div>
                </Rollout>

                <Rollout title="Draft" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Draft On/Off</label>
                      <button 
                        onClick={() => onParamChange('draftAngle', selectedFeature.parameters.draftAngle ? 0 : 5)}
                        className={`px-3 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.draftAngle ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                      >
                        {selectedFeature.parameters.draftAngle ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    {selectedFeature.parameters.draftAngle !== undefined && selectedFeature.parameters.draftAngle > 0 && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                        <ParamInput label="Draft Angle" value={selectedFeature.parameters.draftAngle} onChange={(v) => onParamChange('draftAngle', v)} unit="deg" badge="ANG" />
                        <button 
                          onClick={() => onParamChange('draftOutward', !selectedFeature.parameters.draftOutward)}
                          className={`w-full py-1 rounded text-[10px] font-bold border ${selectedFeature.parameters.draftOutward ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white text-slate-600 border-slate-200'}`}
                        >
                          {selectedFeature.parameters.draftOutward ? 'Draft Outward' : 'Draft Inward'}
                        </button>
                      </div>
                    )}
                  </div>
                </Rollout>

                <Rollout title="Selected Contours" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}>
                  <SelectionBox 
                    label="Contours"
                    items={(selectedFeature.parameters.selectedContours || []).map((ref: any, idx: number) => ({ id: ref.id || ref || `${idx}`, name: `Edge/Region ${idx + 1}` }))}
                    onRemove={(id) => {
                      const current = selectedFeature.parameters.selectedContours || [];
                      onParamChange('selectedContours', current.filter((r: any) => (r.id || r) !== id));
                    }}
                    onClear={() => onParamChange('selectedContours', [])}
                    placeholder="Select sketch contours or regions"
                  />
                  <div className="mt-2 text-[9px] text-slate-400 italic leading-tight">
                    Leave empty to extrude the entire sketch profile.
                  </div>
                </Rollout>
              </>
            )}

            {selectedFeature.type === 'REVOLVE' && (
              <>
                <Rollout 
                  title={selectedFeature.parameters.operation === 'CUT' ? "Revolve Cut Parameters" : "Revolve Parameters"} 
                  icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={selectedFeature.parameters.operation === 'CUT' ? "#EF4444" : "currentColor"} strokeWidth="3"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>}
                >
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Revolve Type</label>
                      <select 
                        value={selectedFeature.parameters.endCondition || 'BLIND'} 
                        onChange={(e) => onParamChange('endCondition', e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                      >
                        <option value="BLIND">Blind</option>
                        <option value="MID_PLANE">Mid Plane</option>
                      </select>
                    </div>
                    <ParamInput label="Angle" value={selectedFeature.parameters.angle} onChange={(v) => onParamChange('angle', v)} unit="deg" badge="A1" />
                  </div>
                </Rollout>

                <Rollout title="Direction 2" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m19 12-7 7-7-7"/><path d="M12 5v14"/></svg>}>
                   <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Enable Direction 2</label>
                      <button 
                        onClick={() => onParamChange('hasDirection2', !selectedFeature.parameters.hasDirection2)}
                        className={`px-3 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.hasDirection2 ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                      >
                        {selectedFeature.parameters.hasDirection2 ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    {selectedFeature.parameters.hasDirection2 && (selectedFeature.parameters.endCondition || 'BLIND') !== 'MID_PLANE' && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                        <ParamInput label="Angle 2" value={selectedFeature.parameters.angle2 || 90} onChange={(v) => onParamChange('angle2', v)} unit="deg" badge="A2" />
                      </div>
                    )}
                  </div>
                </Rollout>

                <Rollout title="Axis of Revolution" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="5 12 12 12 19 12"/></svg>}>
                  <SelectionBox 
                    label="Axis Selection"
                    items={selectedFeature.parameters.axis_edge_id ? [{ id: selectedFeature.parameters.axis_edge_id, name: `Axis (${selectedFeature.parameters.axis_edge_id.slice(0, 4)})` }] : []}
                    onRemove={() => {
                      onParamChange('axis_edge_id', null);
                      onParamChange('axis_points', null);
                    }}
                    onClear={() => {
                      onParamChange('axis_edge_id', null);
                      onParamChange('axis_points', null);
                    }}
                    placeholder="Select a line or axis"
                    active={pendingFeatureCommand === 'REVOLVE'}
                    onClick={() => useCadStore.setState({ pendingFeatureCommand: 'REVOLVE' })}
                  />
                </Rollout>

                <Rollout title="Thin Feature" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Thin Revolve</label>
                      <button 
                        onClick={() => onParamChange('isThinFeature', !selectedFeature.parameters.isThinFeature)}
                        className={`px-3 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.isThinFeature ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                      >
                        {selectedFeature.parameters.isThinFeature ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    {selectedFeature.parameters.isThinFeature && (
                      <ParamInput label="Thickness" value={selectedFeature.parameters.thinThickness || 1.0} onChange={(v) => onParamChange('thinThickness', v)} badge="THK" />
                    )}
                  </div>
                </Rollout>

                <Rollout title="Selected Contours" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}>
                  <SelectionBox 
                    label="Contours"
                    items={(selectedFeature.parameters.selectedContours || []).map((ref: any, idx: number) => ({ id: ref.id || ref || `${idx}`, name: `Edge/Region ${idx + 1}` }))}
                    onRemove={(id) => {
                      const current = selectedFeature.parameters.selectedContours || [];
                      onParamChange('selectedContours', current.filter((r: any) => (r.id || r) !== id));
                    }}
                    onClear={() => onParamChange('selectedContours', [])}
                    placeholder="Select sketch contours or regions"
                  />
                </Rollout>
              </>
            )}

            {(selectedFeature.type === 'FILLET' || selectedFeature.type === 'CHAMFER') && (
              <>
                <Rollout title="Fillet Type" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 0 1 7 7"/></svg>}>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { id: 'CONSTANT', label: 'Constant', icon: '🔵' },
                      { id: 'VARIABLE', label: 'Variable', icon: '🟢' },
                      { id: 'FACE', label: 'Face', icon: '🟧' },
                      { id: 'FULL_ROUND', label: 'Full', icon: '⚪' }
                    ].map(t => (
                      <button
                        key={t.id}
                        onClick={() => onParamChange('filletType', t.id)}
                        className={`flex flex-col items-center justify-center p-1.5 rounded border transition-all ${
                          (selectedFeature.parameters.filletType || 'CONSTANT') === t.id
                            ? 'bg-primary/10 border-primary text-primary shadow-inner'
                            : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
                        }`}
                        title={t.label}
                      >
                        <span className="text-sm">{t.icon}</span>
                      </button>
                    ))}
                  </div>
                </Rollout>

                <Rollout title="Items to Fillet" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}>
                  <div className="space-y-3">
                    {(!selectedFeature.parameters.filletType || selectedFeature.parameters.filletType === 'CONSTANT' || selectedFeature.parameters.filletType === 'VARIABLE') && (
                      <SelectionBox 
                        label={selectedFeature.type === 'FILLET' ? "Edges to Fillet" : "Edges to Chamfer"}
                        items={(selectedFeature.parameters.refs || []).map((ref: any, idx: number) => ({ id: ref.id || `${idx}`, name: `Edge ${idx + 1}` }))}
                        onRemove={(id) => onParamChange('refs', selectedFeature.parameters.refs.filter((r: any) => r.id !== id))}
                        onClear={() => onParamChange('refs', [])}
                        placeholder="Select edges from 3D view"
                        active={pendingFeatureCommand === 'FILLET'}
                        onClick={() => useCadStore.setState({ pendingFeatureCommand: 'FILLET' })}
                      />
                    )}

                    {selectedFeature.parameters.filletType === 'VARIABLE' && (
                      <div className="p-2 bg-slate-50 rounded border border-slate-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Points</label>
                          <input 
                            type="number" 
                            min="2" 
                            max="10"
                            value={(selectedFeature.parameters.variablePoints || []).length || 2} 
                            onChange={(e) => {
                              const count = parseInt(e.target.value) || 2;
                              const current = selectedFeature.parameters.variablePoints || [{ r: 2.0 }, { r: 5.0 }];
                              let next;
                              if (count > current.length) {
                                next = [...current, ...Array(count - current.length).fill({ r: 2.0 })];
                              } else {
                                next = current.slice(0, count);
                              }
                              onParamChange('variablePoints', next);
                            }}
                            className="w-12 bg-white border border-slate-200 rounded px-1 py-0.5 text-[11px] font-bold text-center"
                          />
                        </div>

                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {(selectedFeature.parameters.variablePoints || [{ r: 2.0 }, { r: 5.0 }]).map((p: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between gap-2">
                              <span className="text-[10px] text-slate-400 font-mono">P{idx + 1}</span>
                              <input 
                                type="number" 
                                value={p.r} 
                                onChange={(e) => {
                                  const newPoints = [...(selectedFeature.parameters.variablePoints || [{ r: 2.0 }, { r: 5.0 }])];
                                  newPoints[idx] = { ...newPoints[idx], r: parseFloat(e.target.value) || 0 };
                                  onParamChange('variablePoints', newPoints);
                                }}
                                className="w-full bg-white border border-slate-200 rounded px-1 py-0.5 text-[11px] font-bold text-right"
                              />
                            </div>
                          ))}
                        </div>

                        <div className="flex flex-col gap-1 border-t border-slate-200 pt-2">
                           <label className="text-[10px] font-bold text-slate-500 uppercase">Transition</label>
                           <div className="flex gap-1">
                              {['SMOOTH', 'STRAIGHT'].map(mode => (
                                <button
                                  key={mode}
                                  onClick={() => onParamChange('transitionType', mode)}
                                  className={`flex-1 py-1 rounded text-[9px] font-black border transition-all ${
                                    (selectedFeature.parameters.transitionType || 'SMOOTH') === mode
                                      ? 'bg-indigo-600 text-white border-indigo-600'
                                      : 'bg-white text-slate-400 border-slate-200'
                                  }`}
                                >
                                  {mode}
                                </button>
                              ))}
                           </div>
                        </div>
                      </div>
                    )}

                    {selectedFeature.parameters.filletType === 'FACE' && (
                      <div className="space-y-2">
                        <SelectionBox 
                          label="Face Set 1"
                          items={(selectedFeature.parameters.faceSet1 || []).map((ref: any) => ({ id: ref.id, name: `Face ${ref.id.slice(0, 4)}` }))}
                          onRemove={(id) => onParamChange('faceSet1', selectedFeature.parameters.faceSet1.filter((r: any) => r.id !== id))}
                          onClear={() => onParamChange('faceSet1', [])}
                          placeholder="Select first set of faces"
                        />
                        <SelectionBox 
                          label="Face Set 2"
                          items={(selectedFeature.parameters.faceSet2 || []).map((ref: any) => ({ id: ref.id, name: `Face ${ref.id.slice(0, 4)}` }))}
                          onRemove={(id) => onParamChange('faceSet2', selectedFeature.parameters.faceSet2.filter((r: any) => r.id !== id))}
                          onClear={() => onParamChange('faceSet2', [])}
                          placeholder="Select second set of faces"
                        />
                        <div className="border-t border-slate-100 my-2 pt-2 space-y-3">
                           <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Constant Width</label>
                            <button 
                              onClick={() => onParamChange('isConstantWidth', !selectedFeature.parameters.isConstantWidth)}
                              className={`px-3 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.isConstantWidth ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                            >
                              {selectedFeature.parameters.isConstantWidth ? 'ON' : 'OFF'}
                            </button>
                          </div>
                          <SelectionBox 
                            label="Hold Line"
                            items={(selectedFeature.parameters.holdLineRefs || []).map((ref: any) => ({ id: ref.id, name: `Edge ${ref.id.slice(0, 4)}` }))}
                            onRemove={(id) => onParamChange('holdLineRefs', selectedFeature.parameters.holdLineRefs.filter((r: any) => r.id !== id))}
                            onClear={() => onParamChange('holdLineRefs', [])}
                            placeholder="Select edge to limit fillet"
                            active={pendingFeatureCommand === 'FILLET'}
                            onClick={() => useCadStore.setState({ pendingFeatureCommand: 'FILLET' })}
                          />
                        </div>
                      </div>
                    )}

                    {selectedFeature.parameters.filletType === 'FULL_ROUND' && (
                      <div className="space-y-2">
                        <SelectionBox label="Side Face 1" items={selectedFeature.parameters.fullRoundSet1 ? [selectedFeature.parameters.fullRoundSet1].map(r => ({ id: r.id, name: `Face ${r.id.slice(0,4)}` })) : []} onRemove={() => onParamChange('fullRoundSet1', null)} onClear={() => onParamChange('fullRoundSet1', null)} placeholder="Select first side face" />
                        <SelectionBox label="Center Face" items={selectedFeature.parameters.fullRoundCenter ? [selectedFeature.parameters.fullRoundCenter].map(r => ({ id: r.id, name: `Face ${r.id.slice(0,4)}` })) : []} onRemove={() => onParamChange('fullRoundCenter', null)} onClear={() => onParamChange('fullRoundCenter', null)} placeholder="Select center face" />
                        <SelectionBox label="Side Face 2" items={selectedFeature.parameters.fullRoundSet2 ? [selectedFeature.parameters.fullRoundSet2].map(r => ({ id: r.id, name: `Face ${r.id.slice(0,4)}` })) : []} onRemove={() => onParamChange('fullRoundSet2', null)} onClear={() => onParamChange('fullRoundSet2', null)} placeholder="Select second side face" />
                      </div>
                    )}
                  </div>
                </Rollout>

                <Rollout title="Fillet Parameters" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 0 1 7 7"/></svg>}>
                  <div className="space-y-3">
                    {selectedFeature.type === 'FILLET' && (selectedFeature.parameters.filletType || 'CONSTANT') === 'CONSTANT' && (
                       <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Multiple Radius Fillet</label>
                        <button 
                          onClick={() => onParamChange('isMultiRadius', !selectedFeature.parameters.isMultiRadius)}
                          className={`px-3 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.isMultiRadius ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                        >
                          {selectedFeature.parameters.isMultiRadius ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    )}
                    
                    {(!selectedFeature.parameters.isMultiRadius || selectedFeature.parameters.filletType !== 'CONSTANT') && selectedFeature.parameters.filletType !== 'FULL_ROUND' && (
                      <ParamInput 
                        label={selectedFeature.type === 'FILLET' ? "Radius" : "Distance"} 
                        value={selectedFeature.parameters[selectedFeature.type === 'FILLET' ? 'radius' : 'distance']} 
                        onChange={(v) => onParamChange(selectedFeature.type === 'FILLET' ? 'radius' : 'distance', v)} 
                        badge={selectedFeature.type === 'FILLET' ? 'R1' : 'D1'} 
                      />
                    )}

                    {selectedFeature.parameters.isMultiRadius && (selectedFeature.parameters.filletType || 'CONSTANT') === 'CONSTANT' && (
                      <div className="space-y-1 max-h-40 overflow-y-auto border-t border-slate-100 pt-2 mt-2">
                         {(selectedFeature.parameters.refs || []).map((ref: any, idx: number) => (
                            <div key={ref.id || idx} className="flex items-center justify-between gap-2 p-1.5 bg-slate-50 rounded border border-slate-200/50">
                              <span className="text-[10px] font-bold text-slate-600 truncate flex-1">
                                {ref.type === 'FACE' ? 'Face' : 'Edge'} {ref.id?.slice(0, 4) || (idx + 1)}
                              </span>
                              <input 
                                type="number" 
                                value={ref.radius || selectedFeature.parameters.radius || 2} 
                                onChange={(e) => {
                                  const newRefs = [...selectedFeature.parameters.refs];
                                  newRefs[idx] = { ...ref, radius: parseFloat(e.target.value) || 0 };
                                  onParamChange('refs', newRefs);
                                }}
                                className="w-16 bg-white border border-slate-300 rounded px-1 py-0.5 text-[11px] font-black text-right"
                              />
                            </div>
                         ))}
                      </div>
                    )}

                    {selectedFeature.type === 'FILLET' && (!selectedFeature.parameters.filletType || selectedFeature.parameters.filletType === 'CONSTANT') && !selectedFeature.parameters.isMultiRadius && (
                      <ParamInput label="Radius 2" value={selectedFeature.parameters.radius2} onChange={(v) => onParamChange('radius2', v)} badge="R2" />
                    )}

                    {selectedFeature.type === 'FILLET' && (selectedFeature.parameters.filletType || 'CONSTANT') === 'CONSTANT' && (
                      <div className="space-y-2 border-t border-slate-100 pt-2 mt-2">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Fillet Profile</label>
                          <select
                            value={selectedFeature.parameters.profileType || 'CIRCULAR'}
                            onChange={(e) => onParamChange('profileType', e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                          >
                            <option value="CIRCULAR">Circular</option>
                            <option value="CONIC_RHO">Conic Rho</option>
                            <option value="CONIC_RADIUS">Conic Radius</option>
                            <option value="CURVATURE_CONTINUOUS">Curvature Continuous (G2)</option>
                          </select>
                        </div>
                        {selectedFeature.parameters.profileType === 'CONIC_RHO' && (
                          <ParamInput label="Rho" value={selectedFeature.parameters.rho || 0.5} onChange={(v) => onParamChange('rho', v)} badge="RHO" />
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2 mt-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Tangent Propagation</label>
                      <button 
                        onClick={() => onParamChange('tangentPropagation', selectedFeature.parameters.tangentPropagation === undefined ? false : !selectedFeature.parameters.tangentPropagation)}
                        className={`px-3 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.tangentPropagation !== false ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                      >
                        {selectedFeature.parameters.tangentPropagation !== false ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>
                </Rollout>

                <Rollout title="Setback Parameters" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}>
                   <div className="space-y-3">
                    <SelectionBox 
                      label="Vertices"
                      items={(selectedFeature.parameters.setbackRefs || []).map((ref: any, idx: number) => ({ id: ref.id, name: `Vertex ${ref.id.slice(0, 4)}` }))}
                      onRemove={(id) => onParamChange('setbackRefs', selectedFeature.parameters.setbackRefs.filter((r: any) => r.id !== id))}
                      onClear={() => onParamChange('setbackRefs', [])}
                      placeholder="Select corners for setback"
                      active={pendingFeatureCommand === 'FILLET'}
                      onClick={() => useCadStore.setState({ pendingFeatureCommand: 'FILLET' })}
                    />
                    <ParamInput label="Setback Dist" value={selectedFeature.parameters.setbackDist || 2.0} onChange={(v) => onParamChange('setbackDist', v)} badge="SET" />
                  </div>
                </Rollout>

                <Rollout title="Fillet Options" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/></svg>}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Keep Features</label>
                      <button 
                        onClick={() => onParamChange('keepFeatures', !selectedFeature.parameters.keepFeatures)}
                        className={`px-3 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.keepFeatures ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                      >
                        {selectedFeature.parameters.keepFeatures ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Round Corners</label>
                      <button 
                        onClick={() => onParamChange('roundCorners', !selectedFeature.parameters.roundCorners)}
                        className={`px-3 py-1 rounded text-[10px] font-black border transition-all ${selectedFeature.parameters.roundCorners ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                      >
                        {selectedFeature.parameters.roundCorners ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>
                </Rollout>
              </>
            )}

            {selectedFeature.type === 'SHELL' && (
              <>
                <Rollout title="Parameters" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/></svg>}>
                  <div className="space-y-3">
                    <ParamInput label="Thickness" value={selectedFeature.parameters.thickness} onChange={(v) => onParamChange('thickness', v)} badge="T1" />
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Shell Outward</label>
                      <button
                        onClick={() => onParamChange('flip', !selectedFeature.parameters.flip)}
                        className={`px-3 py-1 rounded text-[11px] font-bold transition-all border ${
                          selectedFeature.parameters.flip ? 'bg-teal-600 text-white border-teal-600 shadow-sm' : 'bg-white text-teal-600 border-teal-200 hover:bg-teal-50'
                        }`}
                      >
                        {selectedFeature.parameters.flip ? 'OUTWARD' : 'OFF'}
                      </button>
                    </div>
                  </div>
                </Rollout>
                <Rollout title="Faces to Remove" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>}>
                  <SelectionBox 
                    label="Selected Faces"
                    items={(selectedFeature.parameters.faces_to_remove_refs || []).map((ref: any) => ({ id: ref.id, name: `Face ${ref.id.slice(0, 4)}` }))}
                    onRemove={(id) => onParamChange('faces_to_remove_refs', selectedFeature.parameters.faces_to_remove_refs.filter((r: any) => r.id !== id))}
                    onClear={() => onParamChange('faces_to_remove_refs', [])}
                    placeholder="Select faces to remove"
                  />
                </Rollout>
              </>
            )}

            {selectedFeature.type === 'HOLE_WIZARD' && (
              <>
                <Rollout title="Hole Type" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>}>
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      { id: 'SIMPLE', label: 'Simple', icon: '🕳️' },
                      { id: 'COUNTERBORE', label: 'C-Bore', icon: '⧉' },
                      { id: 'COUNTERSINK', label: 'C-Sink', icon: '⌵' }
                    ].map(t => (
                      <button
                        key={t.id}
                        onClick={() => onParamChange('hole_type', t.id)}
                        className={`flex flex-col items-center justify-center p-1.5 rounded border transition-all ${
                          (selectedFeature.parameters.hole_type || 'SIMPLE') === t.id
                            ? 'bg-primary/10 border-primary text-primary shadow-inner'
                            : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-lg">{t.icon}</span>
                        <span className="text-[9px] font-black mt-1 uppercase tracking-tighter">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </Rollout>

                <Rollout title="Standard & Size">
                   <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Standard</label>
                      <select 
                        value={selectedFeature.parameters.standard || 'ISO'} 
                        onChange={(e) => onParamChange('standard', e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                      >
                        <option value="ISO">ISO (Metric)</option>
                        <option value="ANSI">ANSI Inch</option>
                        <option value="DIN">DIN</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Size</label>
                      <select 
                        value={selectedFeature.parameters.size || 'M5'} 
                        onChange={(e) => {
                          const size = e.target.value;
                          onParamChange('size', size);
                          // Auto-fill based on ISO Metric defaults
                          if (size === 'M3') { onParamChange('diameter', 3.4); onParamChange('cb_diameter', 6); onParamChange('cb_depth', 3.3); }
                          if (size === 'M4') { onParamChange('diameter', 4.5); onParamChange('cb_diameter', 8); onParamChange('cb_depth', 4.4); }
                          if (size === 'M5') { onParamChange('diameter', 5.5); onParamChange('cb_diameter', 10); onParamChange('cb_depth', 5.4); }
                          if (size === 'M6') { onParamChange('diameter', 6.6); onParamChange('cb_diameter', 11); onParamChange('cb_depth', 6.5); }
                        }}
                        className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                      >
                        <option value="M3">M3</option>
                        <option value="M4">M4</option>
                        <option value="M5">M5</option>
                        <option value="M6">M6</option>
                        <option value="M8">M8</option>
                        <option value="CUSTOM">Custom</option>
                      </select>
                    </div>
                  </div>
                </Rollout>

                <Rollout title="Hole Specifications">
                  <div className="space-y-3">
                    <ParamInput label="Diameter" value={selectedFeature.parameters.diameter || 5.5} onChange={(v) => onParamChange('diameter', v)} badge="Ø" />
                    <ParamInput label="Total Depth" value={selectedFeature.parameters.depth || 10} onChange={(v) => onParamChange('depth', v)} badge="HT" />
                    
                    {selectedFeature.parameters.hole_type === 'COUNTERBORE' && (
                      <div className="pt-2 border-t border-slate-100 space-y-3 animate-in fade-in slide-in-from-top-1">
                        <ParamInput label="C-Bore Dia" value={selectedFeature.parameters.cb_diameter || 10} onChange={(v) => onParamChange('cb_diameter', v)} badge="CBØ" />
                        <ParamInput label="C-Bore Depth" value={selectedFeature.parameters.cb_depth || 5} onChange={(v) => onParamChange('cb_depth', v)} badge="CBH" />
                      </div>
                    )}

                    {selectedFeature.parameters.hole_type === 'COUNTERSINK' && (
                      <div className="pt-2 border-t border-slate-100 space-y-3 animate-in fade-in slide-in-from-top-1">
                        <ParamInput label="C-Sink Dia" value={selectedFeature.parameters.cs_diameter || 10} onChange={(v) => onParamChange('cs_diameter', v)} badge="CSØ" />
                        <ParamInput label="C-Sink Angle" value={selectedFeature.parameters.cs_angle || 90} onChange={(v) => onParamChange('cs_angle', v)} unit="deg" badge="∠" />
                      </div>
                    )}
                  </div>
                </Rollout>

                <Rollout title="Positions">
                  <SelectionBox 
                    label="Placement Points"
                    items={(selectedFeature.parameters.hole_placement_refs || []).map((ref: any, idx: number) => ({ id: ref.id, name: `Point ${idx + 1}` }))}
                    onRemove={(id) => onParamChange('hole_placement_refs', selectedFeature.parameters.hole_placement_refs.filter((r: any) => r.id !== id))}
                    onClear={() => onParamChange('hole_placement_refs', [])}
                    placeholder="Select faces or sketch points"
                    active={pendingFeatureCommand === 'HOLE_WIZARD'}
                    onClick={() => useCadStore.setState({ pendingFeatureCommand: 'HOLE_WIZARD' })}
                  />
                </Rollout>
              </>
            )}

            {selectedFeature.type === 'DOME' && (
              <>
                <Rollout title="Dome Parameters" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M2 12C2 17.52 6.48 22 12 22s10-4.48 10-10S17.52 2 12 2 2 6.48 2 12z" strokeOpacity="0.3"/><path d="M12 2C6.48 2 2 6.48 2 12h20c0-5.52-4.48-10-10-10z"/></svg>}>
                  <div className="space-y-3">
                    <ParamInput label="Distance" value={selectedFeature.parameters.height} onChange={(v) => onParamChange('height', v)} badge="HT" />
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Reverse Direction</label>
                      <button
                        onClick={() => onParamChange('flip', !selectedFeature.parameters.flip)}
                        className={`px-3 py-1 rounded text-[11px] font-bold transition-all border ${
                          selectedFeature.parameters.flip ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50'
                        }`}
                      >
                        {selectedFeature.parameters.flip ? 'REVERSED' : 'DEFAULT'}
                      </button>
                    </div>
                  </div>
                </Rollout>
                <Rollout title="Faces to Dome" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>}>
                  <SelectionBox 
                    label="Selected Faces"
                    items={(selectedFeature.parameters.faces_refs || []).map((ref: any) => ({ id: ref.id, name: `Face ${ref.id.slice(0, 4)}` }))}
                    onRemove={(id) => onParamChange('faces_refs', selectedFeature.parameters.faces_refs.filter((r: any) => r.id !== id))}
                    onClear={() => onParamChange('faces_refs', [])}
                    placeholder="Select faces to apply dome"
                    active={pendingFeatureCommand === 'DOME'}
                    onClick={() => useCadStore.setState({ pendingFeatureCommand: 'DOME' })}
                  />
                </Rollout>
              </>
            )}

            {selectedFeature.type === 'SWEEP' && (
              <>
                <Rollout title="Profile and Path" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M4 22C4 13 14 13 14 4"/><circle cx="14" cy="4" r="2"/><circle cx="4" cy="22" r="2"/></svg>}>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Profile</label>
                      <select value={selectedFeature.parameters.profile_id || ''} onChange={(e) => onParamChange('profile_id', e.target.value)} className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold">
                        <option value="">— Select Sketch —</option>
                        {features.filter(f => f.type === 'SKETCH').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Path</label>
                      <select value={selectedFeature.parameters.path_id || ''} onChange={(e) => onParamChange('path_id', e.target.value)} className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold">
                        <option value="">— Select Sketch —</option>
                        {features.filter(f => f.type === 'SKETCH').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>
                    </div>
                    </Rollout>

                    <Rollout title="Guide Curves" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}>
                    <div className="space-y-2">
                    <select
                       value=""
                       onChange={(e) => {
                         const id = e.target.value;
                         if (!id) return;
                         const current = selectedFeature.parameters.guide_ids || [];
                         if (!current.includes(id)) onParamChange('guide_ids', [...current, id]);
                       }}
                       className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                     >
                       <option value="">+ Add Guide Curve (Sketch)...</option>
                       {features.filter(f => f.type === 'SKETCH' && f.id !== selectedFeature.parameters.profile_id && f.id !== selectedFeature.parameters.path_id && !(selectedFeature.parameters.guide_ids || []).includes(f.id)).map(f => (
                         <option key={f.id} value={f.id}>{f.name}</option>
                       ))}
                     </select>
                     <SelectionBox 
                       label="Selected Guides"
                       items={(selectedFeature.parameters.guide_ids || []).map((id: string) => ({ id, name: features.find(f => f.id === id)?.name || id }))}
                       onRemove={(id) => onParamChange('guide_ids', (selectedFeature.parameters.guide_ids || []).filter((gid: string) => gid !== id))}
                       onClear={() => onParamChange('guide_ids', [])}
                       placeholder="Select sketches from the tree"
                     />
                    </div>
                    </Rollout>
              </>
            )}

            {selectedFeature.type === 'MIRROR' && (
              <>
                <Rollout title="Mirror Plane/Face" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 3v18M3 12h18"/></svg>}>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Primary Plane</label>
                      <select 
                        value={selectedFeature.parameters.mirror_plane_refs?.[0]?.id || ''} 
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'FRONT' || val === 'TOP' || val === 'RIGHT') {
                            onParamChange('mirror_plane_refs', [{ type: 'PLANE', id: val }]);
                          }
                        }} 
                        className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                      >
                        <option value="">— Select Face in Viewport —</option>
                        <option value="FRONT">Front Plane</option>
                        <option value="TOP">Top Plane</option>
                        <option value="RIGHT">Right Plane</option>
                      </select>
                    </div>
                    <SelectionBox 
                      label="Mirror Face"
                      items={(selectedFeature.parameters.mirror_plane_refs || []).filter((r: any) => r.type === 'FACE').map((ref: any) => ({ id: ref.id, name: `Face ${ref.id.slice(0, 4)}` }))}
                      onRemove={(id) => onParamChange('mirror_plane_refs', selectedFeature.parameters.mirror_plane_refs.filter((r: any) => r.id !== id))}
                      onClear={() => onParamChange('mirror_plane_refs', [])}
                      placeholder="Or select a face..."
                      active={pendingFeatureCommand === 'MIRROR'}
                      onClick={() => useCadStore.setState({ pendingFeatureCommand: 'MIRROR' })}
                    />
                  </div>
                </Rollout>

                <Rollout title="Features to Mirror" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}>
                   <div className="space-y-2">
                    <select
                      value=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        const current = selectedFeature.parameters.target_feature_ids || [];
                        if (!current.includes(id)) onParamChange('target_feature_ids', [...current, id]);
                      }}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                    >
                      <option value="">+ Add Feature to Mirror...</option>
                      {features.filter((f) => f.id !== selectedFeature.id && f.type !== 'SKETCH' && !(selectedFeature.parameters.target_feature_ids || []).includes(f.id)).map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    <SelectionBox 
                      label="Selected Features" 
                      items={(selectedFeature.parameters.target_feature_ids || []).map((id: string) => ({ id, name: features.find(f => f.id === id)?.name || id }))} 
                      onRemove={(id) => onParamChange('target_feature_ids', selectedFeature.parameters.target_feature_ids.filter((tid: string) => tid !== id))} 
                      onClear={() => onParamChange('target_feature_ids', [])} 
                      placeholder="Select features from the tree"
                    />
                    <div className="mt-2 text-[9px] text-slate-400 italic leading-tight">
                      Leave empty to mirror the entire body.
                    </div>
                  </div>
                </Rollout>
              </>
            )}

            {selectedFeature.type === 'LOFT' && (
              <>
                <Rollout title="Loft Profiles" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M4 20h16"/><path d="M6 12h12"/><path d="M8 4h8"/><path d="M4 20L8 4"/><path d="M20 20L16 4"/></svg>}>
                  <div className="space-y-2">
                    <select
                      value=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        const current = selectedFeature.parameters.profile_ids || [];
                        if (!current.includes(id)) onParamChange('profile_ids', [...current, id]);
                      }}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                    >
                      <option value="">+ Add Profile Sketch...</option>
                      {features.filter((f) => f.type === 'SKETCH' && !(selectedFeature.parameters.profile_ids || []).includes(f.id)).map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    <SelectionBox label="Profiles" items={(selectedFeature.parameters.profile_ids || []).map((id: string) => ({ id, name: features.find(f => f.id === id)?.name || id }))} onRemove={(id) => onParamChange('profile_ids', selectedFeature.parameters.profile_ids.filter((tid: string) => tid !== id))} onClear={() => onParamChange('profile_ids', [])} />
                  </div>
                </Rollout>

                <Rollout title="Start/End Constraints" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M7 7h10M7 17h10M7 7v10M17 7v10"/></svg>}>
                  <div className="space-y-4">
                    {/* Start Constraint */}
                    <div className="space-y-2">
                      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Start Constraint</div>
                      <select 
                        value={selectedFeature.parameters.startConstraint || 'NONE'} 
                        onChange={(e) => onParamChange('startConstraint', e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[11px] font-bold"
                      >
                        <option value="NONE">None</option>
                        <option value="NORMAL_TO_PROFILE">Normal to Profile</option>
                        <option value="DIRECTION_VECTOR">Direction Vector</option>
                        <option value="TANGENT_TO_FACE">Tangent to Face</option>
                        <option value="CURVATURE_TO_FACE">Curvature to Face (G2)</option>
                      </select>
                      {(selectedFeature.parameters.startConstraint === 'NORMAL_TO_PROFILE' || selectedFeature.parameters.startConstraint === 'DIRECTION_VECTOR' || selectedFeature.parameters.startConstraint === 'TANGENT_TO_FACE' || selectedFeature.parameters.startConstraint === 'CURVATURE_TO_FACE') && (
                        <div className="flex gap-2">
                          <ParamInput label="Magnitude" value={selectedFeature.parameters.startMagnitude ?? 1.0} onChange={(v) => onParamChange('startMagnitude', v)} badge="MAG" className="flex-1" />
                          {(selectedFeature.parameters.startConstraint === 'NORMAL_TO_PROFILE' || selectedFeature.parameters.startConstraint === 'TANGENT_TO_FACE' || selectedFeature.parameters.startConstraint === 'CURVATURE_TO_FACE') && (
                            <ParamInput label="Draft Angle" value={selectedFeature.parameters.startDraftAngle ?? 0.0} onChange={(v) => onParamChange('startDraftAngle', v)} badge="DEG" className="flex-1" />
                          )}
                        </div>
                      )}
                      {(selectedFeature.parameters.startConstraint === 'TANGENT_TO_FACE' || selectedFeature.parameters.startConstraint === 'CURVATURE_TO_FACE') && (
                         <SelectionBox 
                           label="Start Face Reference"
                           items={selectedFeature.parameters.startFaceRef ? [{ id: selectedFeature.parameters.startFaceRef.id, name: `Face ${selectedFeature.parameters.startFaceRef.id.slice(0,4)}` }] : []}
                           onRemove={() => onParamChange('startFaceRef', null)}
                           placeholder="Select tangent face"
                         />
                      )}
                    </div>

                    <div className="h-px bg-slate-100" />

                    {/* End Constraint */}
                    <div className="space-y-2">
                      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">End Constraint</div>
                      <select 
                        value={selectedFeature.parameters.endConstraint || 'NONE'} 
                        onChange={(e) => onParamChange('endConstraint', e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[11px] font-bold"
                      >
                        <option value="NONE">None</option>
                        <option value="NORMAL_TO_PROFILE">Normal to Profile</option>
                        <option value="DIRECTION_VECTOR">Direction Vector</option>
                        <option value="TANGENT_TO_FACE">Tangent to Face</option>
                        <option value="CURVATURE_TO_FACE">Curvature to Face (G2)</option>
                      </select>
                      {(selectedFeature.parameters.endConstraint === 'NORMAL_TO_PROFILE' || selectedFeature.parameters.endConstraint === 'DIRECTION_VECTOR' || selectedFeature.parameters.endConstraint === 'TANGENT_TO_FACE' || selectedFeature.parameters.endConstraint === 'CURVATURE_TO_FACE') && (
                        <div className="flex gap-2">
                          <ParamInput label="Magnitude" value={selectedFeature.parameters.endMagnitude ?? 1.0} onChange={(v) => onParamChange('endMagnitude', v)} badge="MAG" className="flex-1" />
                          {(selectedFeature.parameters.endConstraint === 'NORMAL_TO_PROFILE' || selectedFeature.parameters.endConstraint === 'TANGENT_TO_FACE' || selectedFeature.parameters.endConstraint === 'CURVATURE_TO_FACE') && (
                            <ParamInput label="Draft Angle" value={selectedFeature.parameters.endDraftAngle ?? 0.0} onChange={(v) => onParamChange('endDraftAngle', v)} badge="DEG" className="flex-1" />
                          )}
                        </div>
                      )}
                      {(selectedFeature.parameters.endConstraint === 'TANGENT_TO_FACE' || selectedFeature.parameters.endConstraint === 'CURVATURE_TO_FACE') && (
                         <SelectionBox 
                           label="End Face Reference"
                           items={selectedFeature.parameters.endFaceRef ? [{ id: selectedFeature.parameters.endFaceRef.id, name: `Face ${selectedFeature.parameters.endFaceRef.id.slice(0,4)}` }] : []}
                           onRemove={() => onParamChange('endFaceRef', null)}
                           placeholder="Select tangent face"
                         />
                      )}
                    </div>
                  </div>
                </Rollout>

                <Rollout title="Thin Feature" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h10v10H7z"/></svg>}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Enable Thin</label>
                      <button 
                        onClick={() => onParamChange('isThin', !selectedFeature.parameters.isThin)}
                        className={`w-10 h-5 rounded-full relative transition-all ${selectedFeature.parameters.isThin ? 'bg-indigo-600' : 'bg-slate-300'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${selectedFeature.parameters.isThin ? 'right-1' : 'left-1'}`} />
                      </button>
                    </div>
                    {selectedFeature.parameters.isThin && (
                      <ParamInput label="Thickness" value={selectedFeature.parameters.thickness ?? 2.0} onChange={(v) => onParamChange('thickness', v)} badge="THK" />
                    )}
                  </div>
                </Rollout>
              </>
            )}

            {(selectedFeature.type === 'REFERENCE_PLANE' || selectedFeature.type === 'PLANE') && (
              <Rollout title="Construction Method" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M4 22V4h16v18H4z"/><path d="M4 9h16"/></svg>}>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Method</label>
                    <select 
                      value={selectedFeature.parameters.planeType || 'OFFSET'} 
                      onChange={(e) => onParamChange('planeType', e.target.value)} 
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[12px] font-bold"
                    >
                      <option value="OFFSET">Offset from Plane</option>
                      <option value="THREE_POINTS">Three Points</option>
                      <option value="ANGLE">Angle</option>
                    </select>
                  </div>

                  {(selectedFeature.parameters.planeType === 'OFFSET' || !selectedFeature.parameters.planeType) && (
                    <ParamInput label="Offset Distance" value={selectedFeature.parameters.offset} onChange={(v) => onParamChange('offset', v)} badge="DIST" />
                  )}

                  {selectedFeature.parameters.planeType === 'ANGLE' && (
                    <ParamInput label="Angle" value={selectedFeature.parameters.angle || 0} onChange={(v) => onParamChange('angle', v)} badge="DEG" />
                  )}

                  <SelectionBox 
                    label="References" 
                    selectedCount={selectedFeature.parameters.refs?.length || 0} 
                    onClear={() => onParamChange('refs', [])}
                    placeholder={selectedFeature.parameters.planeType === 'ANGLE' ? "Select Axis then Ref Plane" : "Select planar faces or points"}
                    active={pendingFeatureCommand === 'REFERENCE_PLANE'}
                    onClick={() => useCadStore.setState({ pendingFeatureCommand: 'REFERENCE_PLANE' })}
                  />
                  
                  {selectedFeature.parameters.planeType === 'ANGLE' && (
                    <div className="p-2 bg-indigo-50 border border-indigo-100 rounded text-[10px] text-indigo-700 font-bold leading-tight">
                      First reference must be an axis (linear edge). Second must be a planar face.
                    </div>
                  )}
                </div>
              </Rollout>
            )}

            {selectedFeature.type === 'DUMB_SOLID' && (
              <Rollout title="Translation">
                <div className="space-y-2">
                  {['x', 'y', 'z'].map(axis => <ParamInput key={axis} label={axis.toUpperCase()} value={selectedFeature.parameters[axis]} onChange={(v) => onParamChange(axis, v)} badge={axis.toUpperCase()} />)}
                </div>
              </Rollout>
            )}
          </>
        ) : (
          <div className="space-y-1 animate-in fade-in slide-in-from-right-1 duration-200">
            {(parents.length > 0 || children.length > 0) && (
              <Rollout title="Parent/Child Relations" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M7 21l-4-4m0 0l4-4m-4 4h18V3"/></svg>}>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-slate-400 font-bold mb-1 uppercase tracking-widest text-[9px]">Parents</div>
                    {parents.map((p) => (
                      <button key={p.id} onClick={() => p.type === 'SKETCH' ? onEditSketch(selectedFeature) : onSelectFeature(p.id)} className="w-full text-left mb-1 px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 font-bold truncate">
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <div>
                    <div className="text-slate-400 font-bold mb-1 uppercase tracking-widest text-[9px]">Children</div>
                    {children.map((c) => (
                      <button key={c.id} onClick={() => onSelectFeature(c.id)} className="w-full text-left mb-1 px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-800 font-bold truncate">
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              </Rollout>
            )}
            <Rollout title="Feature Appearance" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/></svg>}>
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-500 uppercase">Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={selectedFeature.color || '#60A5FA'} onChange={(e) => updateFeatureProperty(selectedFeature.id, 'color', e.target.value)} className="w-8 h-8 rounded-md cursor-pointer border-none bg-transparent" />
                  <button onClick={() => updateFeatureProperty(selectedFeature.id, 'color', undefined)} className="text-[10px] text-slate-400 hover:text-red-500 font-bold underline transition-colors">Reset</button>
                </div>
              </div>
            </Rollout>
          </div>
        )}
      </div>
    </div>
  );
}
