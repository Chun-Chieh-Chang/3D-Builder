'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Viewport from '@/renderer/Viewport';
import OcctShape from '@/renderer/OcctShape';
import { useCadStore } from '@/store/useCadStore';
import { HeavyEngineClient } from '@/kernel/HeavyEngineClient';

export default function Home() {
  const { 
    mode, setMode, 
    projectName, 
    features, addFeature, removeFeature, updateFeatureParams, 
    selectedId, setSelectedId,
    meshData, setMeshData,
    isSketchMode, setSketchMode,
    activePlane, setActivePlane,
    sketchPoints, setSketchPoints,
    sketchTool, setSketchTool,
    gridSnap, setGridSnap
  } = useCadStore();

  
  const [loading, setLoading] = useState(false);
  const [engineStatus, setEngineStatus] = useState<'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');
  
  const selectedFeature = useMemo(() => features.find(f => f.id === selectedId), [features, selectedId]);

  // The new "Assembly-Aware" Rebuild Logic
  const handleRebuild = useCallback(async () => {
    if (features.length === 0) {
      setMeshData([]);
      return;
    }
    
    setLoading(true);
    try {
      const client = HeavyEngineClient.getInstance();
      
      // Check health first to update UI
      const isAlive = await client.checkHealth();
      setEngineStatus(isAlive ? 'CONNECTED' : 'DISCONNECTED');
      
      if (!isAlive) {
        console.warn('[API] Heavy Engine is not responding.');
        setLoading(false);
        return;
      }

      console.log('[API] Sending feature list to Python Heavy Engine...', features);
      const results = await client.rebuild(features);
      
      if (results && Array.isArray(results)) {
        setMeshData(results);
      }
    } catch (err) {
      console.error('[API] Rebuild request failed:', err);
      setEngineStatus('DISCONNECTED');
    } finally {
      setLoading(false);
    }
  }, [features, setMeshData]);

  useEffect(() => {
    handleRebuild();
  }, [handleRebuild]);

  const onParamChange = (key: string, value: string) => {
    if (!selectedId) return;
    
    // Industrial Parameter Handling: String-based parameters (Booleans, Planes, Types)
    const stringParams = ['operation', 'plane', 'type'];
    
    if (stringParams.includes(key)) {
      updateFeatureParams(selectedId, { [key]: value });
      return;
    }
    
    const num = parseFloat(value);
    if (isNaN(num)) return;
    updateFeatureParams(selectedId, { [key]: num });
  };


  const addNewFeature = (type: 'EXTRUDE' | 'BOX' | 'CYLINDER' | 'SPHERE') => {
    const id = `feat_${Date.now()}`;
    const names = { EXTRUDE: 'Extrude Feature', BOX: 'Box', CYLINDER: 'Cylinder', SPHERE: 'Sphere' };
    const defaultParams = {
      EXTRUDE: { width: 10, height: 10, depth: 10, x: 0, y: 0, z: 0, operation: 'ADD', plane: 'FRONT' },
      BOX: { width: 10, height: 10, depth: 10, x: 0, y: 0, z: 0 },
      CYLINDER: { radius: 5, height: 10, x: 0, y: 0, z: 0 },
      SPHERE: { radius: 5, x: 0, y: 0, z: 0 }
    };


    addFeature({
      id,
      type,
      name: `${names[type]} ${features.length + 1}`,
      parameters: defaultParams[type]
    });
    setSelectedId(id);
  };

  const handleExitAndExtrude = useCallback(() => {
    if (sketchPoints.length < 3 || !activePlane) return;
    
    const id = `feat_${Date.now()}`;
    addFeature({
      id,
      type: 'EXTRUDE',
      name: `Custom Extrude ${features.length + 1}`,
      parameters: { 
        points: [...sketchPoints],
        depth: 10, 
        x: 0, y: 0, z: 0,
        operation: 'ADD', 
        plane: activePlane 
      }
    });

    setSketchPoints([]);
    setSketchMode(false);
    setActivePlane(null);
    setSelectedId(id);
    
    setTimeout(handleRebuild, 50);
  }, [sketchPoints, activePlane, features, addFeature, setSketchPoints, setSketchMode, setActivePlane, setSelectedId, handleRebuild]);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-72 h-full glass-effect border-r border-border flex flex-col z-10">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold tracking-tight text-foreground">{projectName}</h1>
          <div className="flex gap-2 mt-2">
            {(['PART', 'ASSEMBLY', 'DRAWING'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-1 text-[10px] rounded border transition-all ${
                  mode === m 
                    ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20' 
                    : 'bg-surface/50 text-secondary-text border-border hover:bg-surface'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {isSketchMode ? (
            <div className="p-4 bg-primary/5 h-full border-l-4 border-primary">
              <div className="text-[11px] uppercase tracking-wider text-primary mb-4 font-bold flex justify-between items-center">
                Active Sketch Editor
                <button onClick={() => { setSketchPoints([]); setSketchMode(false); setActivePlane(null); }} className="text-error hover:underline text-[9px]">CANCEL</button>
              </div>
              
              <div className="space-y-4">
                <div className="p-3 bg-surface/40 rounded-xl border border-primary/20">
                  <div className="text-[10px] text-secondary-text mb-2 flex justify-between items-center">
                    <span>DRAWING ON: <span className="text-primary font-bold">{activePlane}</span></span>
                    <span className="text-[8px] text-primary font-semibold px-1 py-0.5 bg-primary/10 rounded uppercase">{sketchTool} MODE</span>
                  </div>
                  
                  {/* Premium Sketch Segment Selector */}
                  <div className="flex gap-2 p-1 bg-background/50 rounded-lg border border-border/80 mb-3">
                    <button 
                      onClick={() => setSketchTool('LINE')} 
                      className={`flex-1 py-1 text-[9px] rounded font-bold transition-all ${
                        sketchTool === 'LINE' 
                          ? 'bg-primary text-white shadow-lg shadow-primary/20' 
                          : 'text-secondary-text hover:bg-surface/50'
                      }`}
                    >
                      直線段 (Line)
                    </button>
                    <button 
                      onClick={() => setSketchTool('ARC')} 
                      className={`flex-1 py-1 text-[9px] rounded font-bold transition-all ${
                        sketchTool === 'ARC' 
                          ? 'bg-primary text-white shadow-lg shadow-primary/20' 
                          : 'text-secondary-text hover:bg-surface/50'
                      }`}
                    >
                      三點圓弧 (Arc)
                    </button>
                  </div>
                  <div className="space-y-2">
                    {sketchPoints.map((pt, i) => {
                      const isControl = pt[2] === 'ARC_CONTROL';
                      return (
                        <div key={i} className="flex gap-2 items-center">
                          <span className={`text-[9px] font-bold w-14 shrink-0 transition-all ${
                            isControl ? 'text-emerald-500 font-semibold' : 'text-secondary-text'
                          }`}>
                            {isControl ? '弧頂 Ctrl' : `端點 P${i+1}`}
                          </span>
                          <div className="flex-1 flex gap-1 items-center">
                            <span className="text-[8px] text-secondary-text font-bold">U:</span>
                            <input 
                              type="number" 
                              value={pt[0]} 
                              onChange={(e) => {
                                const newPts = [...sketchPoints];
                                newPts[i] = [parseFloat(e.target.value) || 0, newPts[i][1], newPts[i][2]];
                                setSketchPoints(newPts);
                              }}
                              className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-xs text-foreground font-mono"
                              placeholder="U"
                            />
                          </div>
                          <div className="flex-1 flex gap-1 items-center">
                            <span className="text-[8px] text-secondary-text font-bold">V:</span>
                            <input 
                              type="number" 
                              value={pt[1]} 
                              onChange={(e) => {
                                const newPts = [...sketchPoints];
                                newPts[i] = [newPts[i][0], parseFloat(e.target.value) || 0, newPts[i][2]];
                                setSketchPoints(newPts);
                              }}
                              className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-xs text-foreground font-mono"
                              placeholder="V"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {sketchPoints.length > 0 && (
                    <div className="mt-4 p-2 bg-primary/10 rounded text-[10px] text-primary text-center">
                      Click the FIRST point or add more points to close the loop.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-border/50">
                <div className="text-[11px] uppercase tracking-wider text-secondary-text mb-4 font-bold flex justify-between items-center">
                  Feature Tree (B-Rep History)
                  <button onClick={handleRebuild} className="text-primary hover:underline text-[9px] uppercase tracking-tighter">Recompute</button>
                </div>
                <div className="space-y-1">
                  {features.map((f) => (
                    <div 
                      key={f.id}
                      onClick={() => setSelectedId(f.id)}
                      className={`group flex items-center justify-between p-2 rounded cursor-pointer transition-all border ${
                        selectedId === f.id 
                          ? 'bg-primary/10 border-primary/30' 
                          : 'hover:bg-primary/5 border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${selectedId === f.id ? 'bg-primary' : 'bg-secondary-text/30'}`} />
                        <div className="flex flex-col">
                          <span className={`text-sm ${selectedId === f.id ? 'text-foreground font-medium' : 'text-secondary-text'}`}>
                            {f.name}
                          </span>
                          <span className="text-[9px] text-secondary-text/60 uppercase">{f.type}</span>
                        </div>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFeature(f.id);
                          setTimeout(handleRebuild, 50);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-error/20 rounded text-secondary-text hover:text-error transition-all"
                        title="Delete Feature"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {selectedFeature && (
                <div className="p-4">
                  <div className="text-[11px] uppercase tracking-wider text-secondary-text mb-4 font-bold">
                    Feature Properties
                  </div>
                  <div className="space-y-4 p-3 bg-surface/40 rounded-xl border border-border/50">
                    {Object.keys(selectedFeature.parameters).map((key) => (
                      <div key={key} className="space-y-1">
                        <label className="text-[10px] text-secondary-text font-medium uppercase">{key}</label>
                        {key === 'operation' ? (
                          <select 
                            value={selectedFeature.parameters[key]} 
                            onChange={(e) => onParamChange(key, e.target.value)}
                            className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:ring-1 focus:ring-primary outline-none text-foreground"
                          >
                            <option value="ADD">JOIN (長出)</option>
                            <option value="CUT">CUT (除料)</option>
                          </select>
                        ) : key === 'plane' ? (
                          <select 
                            value={selectedFeature.parameters[key]} 
                            onChange={(e) => onParamChange(key, e.target.value)}
                            className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:ring-1 focus:ring-primary outline-none text-foreground"
                          >
                            <option value="FRONT">FRONT (XY)</option>
                            <option value="TOP">TOP (XZ)</option>
                            <option value="RIGHT">RIGHT (YZ)</option>
                          </select>
                        ) : (
                          <input 
                            type="number" 
                            step="1"
                            value={selectedFeature.parameters[key]} 
                            onChange={(e) => onParamChange(key, e.target.value)}
                            className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:ring-1 focus:ring-primary outline-none text-foreground transition-all"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-border bg-surface/30">

          <div className="text-[10px] text-secondary-text flex flex-col gap-1">
            <div className="flex justify-between">
              <span className={loading ? 'text-warning' : ''}>STATUS: {loading ? 'OCCT KERNEL BUSY' : 'KERNEL IDLE'}</span>
              <span className={engineStatus === 'CONNECTED' ? 'text-success' : 'text-error'}>API: {engineStatus}</span>
            </div>
            <div className="w-full bg-border/30 h-1 rounded-full overflow-hidden">
               {loading && <div className="h-full bg-primary animate-progress-indefinite" style={{width: '30%'}} />}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Viewport */}
      <section className="flex-1 h-full relative">
        <Viewport>
          {meshData && meshData.length > 0 ? (
            meshData.map((mesh: any, idx: number) => (
              <OcctShape key={idx} data={mesh.data} />
            ))
          ) : (
            <mesh>
              <sphereGeometry args={[1, 32, 32]} />
              <meshStandardMaterial color="#334155" wireframe opacity={0.3} transparent />
            </mesh>
          )}
        </Viewport>
        
        {/* Floating Sketch Viewport HUD */}
        {isSketchMode && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 glass-effect px-4 py-2.5 rounded-2xl flex items-center gap-6 shadow-2xl border border-white/10 z-50 animate-fade-in pointer-events-auto">
            {/* Active Drawing Tool Info */}
            <div className="flex items-center gap-2">
              <span className="text-[14px]">✏️</span>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-primary tracking-wider uppercase">草圖繪製中 (Sketching)</span>
                <span className="text-[8px] text-secondary-text">正在繪製: {sketchTool === 'LINE' ? '直線段 (Line)' : '三點圓弧 (Arc)'}</span>
              </div>
            </div>
            
            {/* Grid Snapping Toggle */}
            <div className="flex items-center gap-2 border-l border-border/60 pl-4">
              <button 
                onClick={() => setGridSnap(!gridSnap)}
                type="button"
                className={`px-2 py-1 rounded text-[9px] font-bold transition-all border ${
                  gridSnap 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                    : 'bg-surface/50 text-secondary-text border-border'
                }`}
              >
                🧲 網格吸附: {gridSnap ? '已啟用' : '已關閉'}
              </button>
            </div>

            {/* Point Count */}
            <div className="flex flex-col items-center justify-center border-l border-border/60 pl-4">
              <span className="text-[11px] font-mono font-bold text-foreground leading-none">{sketchPoints.length}</span>
              <span className="text-[7px] text-secondary-text uppercase tracking-widest text-center mt-1 w-8">節點</span>
            </div>

            {/* Commands */}
            <div className="flex items-center gap-2 border-l border-border/60 pl-4">
              <button
                onClick={handleExitAndExtrude}
                disabled={sketchPoints.length < 3}
                type="button"
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white rounded-xl text-[9px] font-bold shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5"
                title="閉合草圖並長出為 3D 實體"
              >
                ✓ 離開並拉伸 (Extrude)
              </button>
              <button
                onClick={() => { setSketchPoints([]); setSketchMode(false); setActivePlane(null); }}
                type="button"
                className="px-2.5 py-1.5 bg-error/10 hover:bg-error/20 text-error rounded-xl text-[9px] font-bold transition-all hover:scale-105 active:scale-95"
                title="捨棄當前草圖"
              >
                ✗ 捨棄 (Discard)
              </button>
            </div>
          </div>
        )}
        
        {/* Toolbar */}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <div className="glass-effect p-2 rounded-2xl flex flex-col gap-2 shadow-2xl border border-white/10">
            <button 
              onClick={() => addNewFeature('EXTRUDE')}
              className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-primary/20 text-foreground transition-all hover:scale-110 active:scale-95 bg-primary/10" 
              title="Extrude (Sketch-based)"
            >
              🏗️
            </button>
            <div className="w-8 h-px bg-border/50 self-center" />
            <button 
              onClick={() => addNewFeature('BOX')}
              className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-primary/20 text-foreground transition-all hover:scale-110 active:scale-95" 
              title="Add Box"
            >
              📦
            </button>
            <button 
              onClick={() => addNewFeature('CYLINDER')}
              className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-primary/20 text-foreground transition-all hover:scale-110 active:scale-95" 
              title="Add Cylinder"
            >
              🧪
            </button>
            <button 
              onClick={() => addNewFeature('SPHERE')}
              className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-primary/20 text-foreground transition-all hover:scale-110 active:scale-95" 
              title="Add Sphere"
            >
              🔮
            </button>
            <div className="w-8 h-px bg-border/50 self-center" />
            <button className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-primary/20 text-foreground transition-all hover:scale-110 active:scale-95" title="Settings">⚙️</button>
          </div>
        </div>

        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 bg-background/20 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
            <div className="glass-effect px-4 py-2 rounded-full text-[10px] font-bold text-primary animate-pulse border border-primary/20 shadow-xl">
              B-REP KERNEL RECOMPUTING...
            </div>
          </div>
        )}
      </section>
    </main>
  );
}


