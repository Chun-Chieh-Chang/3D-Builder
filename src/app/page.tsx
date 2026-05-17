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
  const [activeTab, setActiveTab] = useState<'FEATURES' | 'SKETCH'>('FEATURES');
  
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


  const addNewFeature = (type: 'EXTRUDE' | 'BOX' | 'CYLINDER' | 'SPHERE', operation: 'ADD' | 'CUT' = 'ADD') => {
    const id = `feat_${Date.now()}`;
    const names = { 
      EXTRUDE: operation === 'ADD' ? '伸長-實體' : '伸長-除料', 
      BOX: '方塊特徵', 
      CYLINDER: '圓柱特徵', 
      SPHERE: '球體特徵' 
    };
    const defaultParams = {
      EXTRUDE: { width: 10, height: 10, depth: 10, x: 0, y: 0, z: 0, operation: operation, plane: 'FRONT' },
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
    <main className="flex flex-col h-screen w-screen overflow-hidden bg-[#0F172A] text-[#F1F5F9] font-sans">
      {/* 1. SolidWorks Desktop Titlebar */}
      <header className="h-[32px] w-full bg-[#0F172A] border-b border-[#334155] flex items-center justify-between px-3 select-none z-30 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <span className="text-primary font-black text-xs">🔷</span>
            <span className="text-[11px] font-bold tracking-tight text-slate-200">SolidWeb 3D-Builder</span>
          </div>
          <nav className="flex items-center gap-3 text-[10px] text-slate-400 font-medium">
            <span className="hover:text-foreground cursor-pointer transition-all">檔案 (F)</span>
            <span className="hover:text-foreground cursor-pointer transition-all">編輯 (E)</span>
            <span className="hover:text-foreground cursor-pointer transition-all">檢視 (V)</span>
            <span className="hover:text-foreground cursor-pointer transition-all">插入 (I)</span>
            <span className="hover:text-foreground cursor-pointer transition-all">工具 (T)</span>
            <span className="hover:text-foreground cursor-pointer transition-all">說明 (H)</span>
          </nav>
        </div>
        
        <div className="text-[10px] text-slate-400 font-medium tracking-tight">
          零件 1.SLDPRT * <span className="text-primary font-semibold">[{activePlane ? `${activePlane} 平面草圖` : '特徵編輯中'}]</span>
        </div>

        <div className="flex items-center gap-4 text-[10px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${engineStatus === 'CONNECTED' ? 'bg-success' : 'bg-error'}`} />
            <span>OCCT 幾何引擎: <span className={engineStatus === 'CONNECTED' ? 'text-success font-bold' : 'text-error'}>{engineStatus}</span></span>
          </div>
          <div className="flex gap-2">
            <span className="hover:text-foreground cursor-pointer">➖</span>
            <span className="hover:text-foreground cursor-pointer">⬜</span>
            <span className="hover:text-error cursor-pointer">❌</span>
          </div>
        </div>
      </header>

      {/* 2. SolidWorks CommandManager (Ribbon Bar) */}
      <div className="h-[95px] w-full bg-[#1E293B] border-b border-[#334155] flex flex-col z-20 shrink-0 select-none">
        {/* Ribbon Tabs */}
        <div className="flex px-4 border-b border-[#334155]/60 bg-[#0F172A]/40">
          <button 
            onClick={() => setActiveTab('FEATURES')}
            className={`px-4 py-1 text-[10px] font-bold tracking-wider transition-all border-b-2 uppercase ${
              activeTab === 'FEATURES' 
                ? 'border-primary text-primary bg-[#1E293B]/60' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            特徵 (Features)
          </button>
          <button 
            onClick={() => {
              setActiveTab('SKETCH');
              // Auto trigger front plane sketch if not in sketch mode
              if (!isSketchMode) {
                setActivePlane('FRONT');
                setSketchMode(true);
              }
            }}
            className={`px-4 py-1 text-[10px] font-bold tracking-wider transition-all border-b-2 uppercase ${
              activeTab === 'SKETCH' 
                ? 'border-primary text-primary bg-[#1E293B]/60' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            草圖 (Sketch)
          </button>
        </div>

        {/* Ribbon Content Panels */}
        <div className="flex-1 flex items-center px-4 py-1 gap-1 overflow-x-auto overflow-y-hidden bg-[#1E293B]/80">
          {activeTab === 'FEATURES' ? (
            <div className="flex items-center gap-1.5 h-full">
              {/* Feature Commands */}
              <button 
                onClick={() => {
                  if (sketchPoints.length >= 3) {
                    handleExitAndExtrude();
                  } else {
                    // Start sketch mode on Front plane
                    setActivePlane('FRONT');
                    setSketchMode(true);
                    setSketchTool('LINE');
                  }
                }}
                className="h-[52px] px-3 rounded hover:bg-slate-700/60 active:bg-slate-700 transition-all flex flex-col items-center justify-center gap-1 group"
                title="拉伸封閉草圖為三維特徵"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🏗️</span>
                <span className="text-[9px] text-slate-200 font-bold leading-none">伸長-實體</span>
              </button>
              
              <button 
                onClick={() => {
                  if (sketchPoints.length >= 3) {
                    // Create Cut
                    const id = `feat_${Date.now()}`;
                    addFeature({
                      id,
                      type: 'EXTRUDE',
                      name: `伸長-除料 ${features.length + 1}`,
                      parameters: { 
                        points: [...sketchPoints],
                        depth: 10, 
                        x: 0, y: 0, z: 0,
                        operation: 'CUT', 
                        plane: activePlane || 'FRONT'
                      }
                    });
                    setSketchPoints([]);
                    setSketchMode(false);
                    setActivePlane(null);
                    setSelectedId(id);
                    setTimeout(handleRebuild, 50);
                  } else {
                    setActivePlane('FRONT');
                    setSketchMode(true);
                    setSketchTool('LINE');
                  }
                }}
                className="h-[52px] px-3 rounded hover:bg-slate-700/60 active:bg-slate-700 transition-all flex flex-col items-center justify-center gap-1 group"
                title="在已有實體上拉伸除料"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🕳️</span>
                <span className="text-[9px] text-slate-200 font-bold leading-none">伸長-除料</span>
              </button>

              <button 
                disabled
                className="h-[52px] px-3 rounded opacity-30 cursor-not-allowed flex flex-col items-center justify-center gap-1"
                title="繞軸旋轉草圖生成實體 (規劃中)"
              >
                <span className="text-lg">🌀</span>
                <span className="text-[9px] text-slate-400 font-medium leading-none">旋轉-實體 🔒</span>
              </button>

              <button 
                disabled
                className="h-[52px] px-3 rounded opacity-30 cursor-not-allowed flex flex-col items-center justify-center gap-1"
                title="為三維實體邊緣修圓角 (規劃中)"
              >
                <span className="text-lg">🪄</span>
                <span className="text-[9px] text-slate-400 font-medium leading-none">圓角 (Fillet) 🔒</span>
              </button>

              <div className="w-[1px] h-[40px] bg-slate-700 mx-2 shrink-0" />

              {/* Spawn Primitives */}
              <button 
                onClick={() => addNewFeature('BOX')}
                className="h-[52px] px-3 rounded hover:bg-slate-700/60 active:bg-slate-700 transition-all flex flex-col items-center justify-center gap-1 group"
                title="快速生成三維方塊實體"
              >
                <span className="text-lg group-hover:scale-110 transition-all">📦</span>
                <span className="text-[9px] text-slate-200 font-bold leading-none">方塊實體</span>
              </button>

              <button 
                onClick={() => addNewFeature('CYLINDER')}
                className="h-[52px] px-3 rounded hover:bg-slate-700/60 active:bg-slate-700 transition-all flex flex-col items-center justify-center gap-1 group"
                title="快速生成三維圓柱實體"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🧪</span>
                <span className="text-[9px] text-slate-200 font-bold leading-none">圓柱實體</span>
              </button>

              <button 
                onClick={() => addNewFeature('SPHERE')}
                className="h-[52px] px-3 rounded hover:bg-slate-700/60 active:bg-slate-700 transition-all flex flex-col items-center justify-center gap-1 group"
                title="快速生成三維球體實體"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🔮</span>
                <span className="text-[9px] text-slate-200 font-bold leading-none">球體實體</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 h-full">
              {/* Sketch Commands */}
              <button 
                onClick={() => {
                  setSketchMode(!isSketchMode);
                  if(!isSketchMode && !activePlane) setActivePlane('FRONT');
                }}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  isSketchMode ? 'bg-primary/20 border border-primary/30' : 'hover:bg-slate-700/60 active:bg-slate-700'
                }`}
                title="啟用/停用二維草圖編輯"
              >
                <span className="text-lg group-hover:scale-110 transition-all">✏️</span>
                <span className="text-[9px] text-slate-200 font-bold leading-none">{isSketchMode ? '結束草圖' : '繪製草圖'}</span>
              </button>

              <button 
                onClick={() => {
                  if (sketchPoints.length > 0) {
                    setSelectedId(null); // Show editor
                  }
                }}
                className="h-[52px] px-3 rounded hover:bg-slate-700/60 active:bg-slate-700 transition-all flex flex-col items-center justify-center gap-1 group"
                title="定量並修改草圖幾何尺寸"
              >
                <span className="text-lg group-hover:scale-110 transition-all">📏</span>
                <span className="text-[9px] text-slate-200 font-bold leading-none">智慧尺寸</span>
              </button>

              <div className="w-[1px] h-[40px] bg-slate-700 mx-2 shrink-0" />

              {/* Sketch Tools */}
              <button 
                onClick={() => setSketchTool('LINE')}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  sketchTool === 'LINE' ? 'bg-primary/10 border border-primary/20' : 'hover:bg-slate-700/60 active:bg-slate-700'
                }`}
                title="繪製直邊輪廓"
              >
                <span className="text-lg group-hover:scale-110 transition-all">📏</span>
                <span className="text-[9px] text-slate-200 font-bold leading-none">直線段</span>
              </button>

              <button 
                onClick={() => setSketchTool('ARC')}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  sketchTool === 'ARC' ? 'bg-primary/10 border border-primary/20' : 'hover:bg-slate-700/60 active:bg-slate-700'
                }`}
                title="繪製三點圓弧輪廓"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🎯</span>
                <span className="text-[9px] text-slate-200 font-bold leading-none">三點圓弧</span>
              </button>

              <div className="w-[1px] h-[40px] bg-slate-700 mx-2 shrink-0" />

              {/* Snapping Toggle */}
              <button 
                onClick={() => setGridSnap(!gridSnap)}
                className={`h-[52px] px-3 rounded transition-all flex flex-col items-center justify-center gap-1 group ${
                  gridSnap ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'hover:bg-slate-700/60 active:bg-slate-700'
                }`}
                title="是否將座標鎖定於整數網格點"
              >
                <span className="text-lg group-hover:scale-110 transition-all">🧲</span>
                <span className="text-[9px] font-bold leading-none">網格吸附</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. Main Workspace Area */}
      <div className="flex-1 flex w-full overflow-hidden relative">
        {/* Left Sidebars: FeatureManager & PropertyManager */}
        <aside className="w-[290px] h-full bg-[#1E293B] border-r border-[#334155] flex flex-col z-10 shrink-0">
          {/* SolidWorks Tab Header */}
          <div className="h-[28px] w-full bg-[#0F172A]/40 flex items-center justify-around border-b border-[#334155]/60 text-slate-400 text-xs">
            <span className="text-primary font-bold cursor-pointer" title="FeatureManager 設計樹">📑 設計樹</span>
            <span className="hover:text-slate-200 cursor-pointer" title="PropertyManager 屬性經理">📋 屬性列</span>
            <span className="hover:text-slate-200 cursor-pointer" title="ConfigurationManager 設定經理">⚙️ 組態</span>
          </div>

          <div className="flex-grow flex flex-col overflow-hidden">
            {isSketchMode ? (
              /* Active Sketch Editor Panel */
              <div className="flex-grow overflow-y-auto p-3 bg-primary/5 border-l-4 border-primary">
                <div className="text-[10px] uppercase tracking-wider text-primary mb-3 font-bold flex justify-between items-center">
                  <span>Active Sketch Editor</span>
                  <button 
                    onClick={() => { setSketchPoints([]); setSketchMode(false); setActivePlane(null); }} 
                    className="text-error hover:underline text-[9px]"
                  >
                    取消草圖
                  </button>
                </div>
                
                <div className="space-y-3">
                  <div className="p-2.5 bg-[#0F172A]/50 rounded-xl border border-primary/20">
                    <div className="text-[10px] text-slate-400 mb-2 flex justify-between items-center">
                      <span>草圖基準面: <span className="text-primary font-bold">{activePlane}</span></span>
                      <span className="text-[8px] text-primary font-semibold px-1 py-0.5 bg-primary/10 rounded uppercase">{sketchTool} 模式</span>
                    </div>

                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {sketchPoints.map((pt, i) => {
                        const isControl = pt[2] === 'ARC_CONTROL';
                        return (
                          <div key={i} className="flex gap-2 items-center">
                            <span className={`text-[9px] font-bold w-12 shrink-0 ${
                              isControl ? 'text-emerald-400 font-semibold' : 'text-slate-400'
                            }`}>
                              {isControl ? '弧頂 Ctrl' : `端點 P${i+1}`}
                            </span>
                            <div className="flex-1 flex gap-1 items-center">
                              <span className="text-[8px] text-slate-500 font-bold">U:</span>
                              <input 
                                type="number" 
                                value={pt[0]} 
                                onChange={(e) => {
                                  const newPts = [...sketchPoints];
                                  newPts[i] = [parseFloat(e.target.value) || 0, newPts[i][1], newPts[i][2]];
                                  setSketchPoints(newPts);
                                }}
                                className="w-full bg-[#0F172A] border border-[#475569] rounded px-1.5 py-0.5 text-xs text-foreground font-mono focus:border-primary outline-none"
                              />
                            </div>
                            <div className="flex-1 flex gap-1 items-center">
                              <span className="text-[8px] text-slate-500 font-bold">V:</span>
                              <input 
                                type="number" 
                                value={pt[1]} 
                                onChange={(e) => {
                                  const newPts = [...sketchPoints];
                                  newPts[i] = [newPts[i][0], parseFloat(e.target.value) || 0, newPts[i][2]];
                                  setSketchPoints(newPts);
                                }}
                                className="w-full bg-[#0F172A] border border-[#475569] rounded px-1.5 py-0.5 text-xs text-foreground font-mono focus:border-primary outline-none"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {sketchPoints.length > 0 && (
                      <div className="mt-3 p-2 bg-primary/10 rounded text-[9px] text-primary/90 text-center font-medium leading-tight">
                        在基準面上點擊定位，或在此精確設定 U, V 參數以定量輪廓！
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* FeatureManager Design Tree */
              <div className="flex-1 overflow-y-auto p-3 flex flex-col">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-3 font-bold flex justify-between items-center border-b border-[#334155] pb-1.5">
                  <span>FeatureManager 設計樹</span>
                  <button onClick={handleRebuild} className="text-primary hover:underline text-[9px] uppercase tracking-tighter">模型重構</button>
                </div>
                
                {/* Standard SolidWorks Meta Nodes */}
                <div className="space-y-1.5 text-xs select-none">
                  <div className="flex items-center gap-2 p-1 text-slate-200 font-bold">
                    <span>🔷</span>
                    <span>零件1 (Part1)</span>
                  </div>
                  
                  <div className="pl-4 space-y-1 text-slate-400">
                    <div className="flex items-center gap-2 p-0.5 hover:text-slate-200 cursor-pointer">
                      <span>📡</span>
                      <span>感測器 (Sensors)</span>
                    </div>
                    <div className="flex items-center gap-2 p-0.5 hover:text-slate-200 cursor-pointer">
                      <span>📝</span>
                      <span>註記 (Annotations)</span>
                    </div>
                    <div className="flex items-center gap-2 p-0.5 hover:text-slate-200 cursor-pointer border-b border-[#334155]/40 pb-1.5">
                      <span>🪵</span>
                      <span>材質 &lt;未指定材質&gt;</span>
                    </div>

                    {/* Standard Plane Selection (Double click triggers sketch) */}
                    <div 
                      onClick={() => { setActivePlane('FRONT'); setSelectedId(null); }}
                      onDoubleClick={() => { setActivePlane('FRONT'); setSketchMode(true); }}
                      className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all ${
                        activePlane === 'FRONT' ? 'bg-primary/20 text-primary font-bold' : 'hover:bg-slate-700/30 hover:text-slate-200'
                      }`}
                      title="點擊選取基準面，按雙擊進入草圖模式"
                    >
                      <div className="flex items-center gap-2">
                        <span>🌐</span>
                        <span>前基準面 (Front Plane)</span>
                      </div>
                      {activePlane === 'FRONT' && <span className="text-[8px] bg-primary/20 px-1 rounded uppercase font-bold">選取</span>}
                    </div>

                    <div 
                      onClick={() => { setActivePlane('TOP'); setSelectedId(null); }}
                      onDoubleClick={() => { setActivePlane('TOP'); setSketchMode(true); }}
                      className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all ${
                        activePlane === 'TOP' ? 'bg-primary/20 text-primary font-bold' : 'hover:bg-slate-700/30 hover:text-slate-200'
                      }`}
                      title="點擊選取基準面，按雙擊進入草圖模式"
                    >
                      <div className="flex items-center gap-2">
                        <span>🌐</span>
                        <span>上基準面 (Top Plane)</span>
                      </div>
                      {activePlane === 'TOP' && <span className="text-[8px] bg-primary/20 px-1 rounded uppercase font-bold">選取</span>}
                    </div>

                    <div 
                      onClick={() => { setActivePlane('RIGHT'); setSelectedId(null); }}
                      onDoubleClick={() => { setActivePlane('RIGHT'); setSketchMode(true); }}
                      className={`flex items-center justify-between p-1 rounded cursor-pointer transition-all ${
                        activePlane === 'RIGHT' ? 'bg-primary/20 text-primary font-bold' : 'hover:bg-slate-700/30 hover:text-slate-200'
                      }`}
                      title="點擊選取基準面，按雙擊進入草圖模式"
                    >
                      <div className="flex items-center gap-2">
                        <span>🌐</span>
                        <span>右基準面 (Right Plane)</span>
                      </div>
                      {activePlane === 'RIGHT' && <span className="text-[8px] bg-primary/20 px-1 rounded uppercase font-bold">選取</span>}
                    </div>

                    <div className="flex items-center gap-2 p-0.5 hover:text-slate-200 cursor-pointer border-b border-[#334155]/40 pb-1.5">
                      <span>📍</span>
                      <span>原點 (Origin)</span>
                    </div>
                  </div>

                  {/* Chronological History Tree */}
                  <div className="pl-2 pt-2 space-y-1">
                    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-1">模型歷史特徵</div>
                    {features.map((f) => (
                      <div 
                        key={f.id}
                        onClick={() => setSelectedId(f.id)}
                        className={`group flex items-center justify-between p-1.5 rounded cursor-pointer transition-all border ${
                          selectedId === f.id 
                            ? 'bg-primary/20 border-primary/40 text-foreground font-bold' 
                            : 'hover:bg-slate-700/40 border-transparent text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">
                            {f.type === 'EXTRUDE' ? (f.parameters.operation === 'CUT' ? '🕳️' : '🏗️') : f.type === 'BOX' ? '📦' : f.type === 'CYLINDER' ? '🧪' : '🔮'}
                          </span>
                          <div className="flex flex-col">
                            <span className="text-[11px] leading-tight">{f.name}</span>
                            <span className="text-[8px] text-slate-400 font-mono leading-none uppercase">{f.type === 'EXTRUDE' ? f.parameters.operation : f.type}</span>
                          </div>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFeature(f.id);
                            setSelectedId(null);
                            setTimeout(handleRebuild, 50);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-error/20 rounded text-slate-400 hover:text-error transition-all"
                          title="刪除特徵"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* PropertyManager (左下角特徵屬性面板) */}
          {!isSketchMode && selectedFeature && (
            <div className="h-[210px] w-full border-t border-[#334155] bg-[#0F172A]/40 flex flex-col p-3 z-10 shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2 font-bold flex justify-between items-center border-b border-[#334155]/40 pb-1">
                <span>📋 PropertyManager</span>
                <span className="text-[8px] bg-primary/20 px-1 rounded uppercase font-mono">{selectedFeature.type}</span>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                {/* direction header */}
                <div className="bg-[#1E293B]/60 p-2 rounded border border-[#334155]">
                  <div className="text-[9px] text-primary font-bold uppercase mb-1.5">方向 1 (Direction 1)</div>
                  
                  <div className="space-y-2 text-xs">
                    {Object.keys(selectedFeature.parameters).map((key) => {
                      // Avoid showing points array directly as a raw field, edit coordinates instead
                      if (key === 'points') return null;
                      return (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <label className="text-[9px] text-slate-400 font-medium uppercase shrink-0">{key}</label>
                          {key === 'operation' ? (
                            <select 
                              value={selectedFeature.parameters[key]} 
                              onChange={(e) => onParamChange(key, e.target.value)}
                              className="bg-[#0F172A] border border-[#475569] rounded px-1 py-0.5 text-[11px] focus:border-primary outline-none text-foreground w-[120px]"
                            >
                              <option value="ADD">伸長-實體 (JOIN)</option>
                              <option value="CUT">伸長-除料 (CUT)</option>
                            </select>
                          ) : key === 'plane' ? (
                            <select 
                              value={selectedFeature.parameters[key]} 
                              onChange={(e) => onParamChange(key, e.target.value)}
                              className="bg-[#0F172A] border border-[#475569] rounded px-1 py-0.5 text-[11px] focus:border-primary outline-none text-foreground w-[120px]"
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
                              className="bg-[#0F172A] border border-[#475569] rounded px-1.5 py-0.5 text-[11px] focus:border-primary outline-none text-foreground font-mono w-[120px] text-right"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sidebar Status Footer */}
          <div className="h-[28px] w-full border-t border-[#334155] bg-[#0F172A]/80 flex items-center justify-between px-3 text-[9px] text-slate-400 shrink-0 font-mono">
            <span className={loading ? 'text-warning animate-pulse' : 'text-slate-400'}>
              {loading ? '⚡ 幾何重構中 (BUSY)...' : '🟢 系統就緒 (READY)'}
            </span>
            <span>MMGS (公釐)</span>
          </div>
        </aside>

        {/* Right Area: Viewport (Graphics Area) */}
        <section className="flex-grow h-full relative">
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
              <div className="flex items-center gap-2">
                <span className="text-[14px]">✏️</span>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-primary tracking-wider uppercase">草圖繪製中 (Sketching)</span>
                  <span className="text-[8px] text-secondary-text">正在繪製: {sketchTool === 'LINE' ? '直線段 (Line)' : '三點圓弧 (Arc)'}</span>
                </div>
              </div>
              
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

              <div className="flex flex-col items-center justify-center border-l border-border/60 pl-4">
                <span className="text-[11px] font-mono font-bold text-foreground leading-none">{sketchPoints.length}</span>
                <span className="text-[7px] text-secondary-text uppercase tracking-widest text-center mt-1 w-8">節點</span>
              </div>

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
          
          {/* Floating Camera View Orientation Toolbar (Right side) */}
          <div className="absolute top-4 right-4 flex flex-col gap-2 z-10 select-none">
            <div className="glass-effect p-1.5 rounded-2xl flex flex-col gap-1.5 shadow-2xl border border-white/10 text-xs">
              <div className="text-[7px] text-slate-400 font-bold uppercase tracking-wider text-center border-b border-slate-700/60 pb-1 mb-1">視角 (View)</div>
              
              <button 
                onClick={() => { setActivePlane('FRONT'); setSelectedId(null); }}
                className={`w-9 h-9 flex flex-col items-center justify-center rounded-xl transition-all ${
                  activePlane === 'FRONT' ? 'bg-primary/20 text-primary border border-primary/30' : 'hover:bg-slate-700/60 text-slate-300'
                }`} 
                title="前視景 (FRONT)"
              >
                <span className="text-[8px] font-bold font-mono">前</span>
                <span className="text-[7px] text-slate-500 leading-none">XY</span>
              </button>

              <button 
                onClick={() => { setActivePlane('TOP'); setSelectedId(null); }}
                className={`w-9 h-9 flex flex-col items-center justify-center rounded-xl transition-all ${
                  activePlane === 'TOP' ? 'bg-primary/20 text-primary border border-primary/30' : 'hover:bg-slate-700/60 text-slate-300'
                }`} 
                title="俯視景 (TOP)"
              >
                <span className="text-[8px] font-bold font-mono">上</span>
                <span className="text-[7px] text-slate-500 leading-none">XZ</span>
              </button>

              <button 
                onClick={() => { setActivePlane('RIGHT'); setSelectedId(null); }}
                className={`w-9 h-9 flex flex-col items-center justify-center rounded-xl transition-all ${
                  activePlane === 'RIGHT' ? 'bg-primary/20 text-primary border border-primary/30' : 'hover:bg-slate-700/60 text-slate-300'
                }`} 
                title="右視景 (RIGHT)"
              >
                <span className="text-[8px] font-bold font-mono">右</span>
                <span className="text-[7px] text-slate-500 leading-none">YZ</span>
              </button>

              <div className="w-6 h-px bg-slate-700 self-center my-0.5" />

              <button 
                onClick={() => {
                  setActivePlane(null);
                  setSelectedId(null);
                  setSketchMode(false);
                }}
                className={`w-9 h-9 flex flex-col items-center justify-center rounded-xl hover:bg-slate-700/60 text-slate-300 transition-all`}
                title="等角透視 (Perspective)"
              >
                <span className="text-[12px]">🌐</span>
                <span className="text-[7px] text-slate-500 leading-none">立體</span>
              </button>
            </div>
          </div>

          {/* Loading Overlay */}
          {loading && (
            <div className="absolute inset-0 bg-background/25 backdrop-blur-[1px] flex items-center justify-center pointer-events-none z-30">
              <div className="glass-effect px-5 py-2.5 rounded-2xl text-[10px] font-bold text-primary animate-pulse border border-primary/25 shadow-2xl flex items-center gap-2">
                <span>🔄</span>
                <span>B-REP 幾何核心特徵重構中...</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}


