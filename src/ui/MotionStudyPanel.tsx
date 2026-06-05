'use client';

import React, { useState, useEffect } from 'react';
import { useCadStore, MotionDriver, CADMate } from '../store/useCadStore';
import { v4 as uuidv4 } from 'uuid';
import { AssemblyService } from '../kernel/AssemblyService';

export const MotionStudyPanel: React.FC = () => {
  const { 
    motionStudy, setMotionStudy, 
    mates, setMates,
    components, setComponents,
    addMotionDriver, removeMotionDriver,
    selectedId 
  } = useCadStore();

  const [isAddingDriver, setIsAddingDriver] = useState(false);
  const [selectedMateId, setSelectedMateId] = useState<string>('');
  const [driverType, setDriverType] = useState<'ROTARY' | 'LINEAR'>('ROTARY');
  const [velocity, setVelocity] = useState(90);

  const assemblyService = new AssemblyService();

  // Animation Loop
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const loop = async () => {
      if (!motionStudy.isActive) return;

      const now = performance.now();
      const deltaTime = (now - lastTime) / 1000; // in seconds
      lastTime = now;

      const updatedTime = motionStudy.currentTime + deltaTime * motionStudy.playbackSpeed;
      
      // Update Driver Mates
      const nextMates = mates.map(mate => {
        const driver = motionStudy.drivers.find(d => d.mateId === mate.id);
        if (driver) {
          if (driver.type === 'ROTARY') {
            const currentAngle = (mate.angle || 0) + driver.velocity * deltaTime * motionStudy.playbackSpeed;
            return { ...mate, angle: currentAngle % 360 };
          } else {
            const currentOffset = (mate.offset || 0) + driver.velocity * deltaTime * motionStudy.playbackSpeed;
            return { ...mate, offset: currentOffset };
          }
        }
        return mate;
      });

      // Solve Assembly
      const solvedComponents = await assemblyService.solve(components, nextMates);
      
      // Update Store
      setMates(nextMates);
      setComponents(solvedComponents);
      setMotionStudy({ currentTime: updatedTime });

      animationFrameId = requestAnimationFrame(loop);
    };

    if (motionStudy.isActive) {
      animationFrameId = requestAnimationFrame(loop);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [motionStudy.isActive, motionStudy.playbackSpeed, motionStudy.drivers, mates, components]);

  const handleTogglePlay = () => {
    setMotionStudy({ isActive: !motionStudy.isActive });
  };

  const handleStop = () => {
    setMotionStudy({ isActive: false, currentTime: 0 });
  };

  const handleReset = () => {
    setMotionStudy({ currentTime: 0 });
    // Reset mate values if needed
  };

  const handleAddDriver = () => {
    if (!selectedMateId) return;
    const newDriver: MotionDriver = {
      id: `driver_${uuidv4()}`,
      mateId: selectedMateId,
      type: driverType,
      velocity: velocity
    };
    addMotionDriver(newDriver);
    setIsAddingDriver(false);
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 h-48 bg-white border-t border-slate-300 shadow-2xl flex flex-col font-sans select-none z-40">
      {/* Header / Controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-4">
          <h3 className="text-[12px] font-black text-slate-800 uppercase tracking-tight">Motion Study</h3>
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded px-2 py-1 shadow-sm">
             <button 
                onClick={handleTogglePlay}
                className={`p-1 rounded hover:bg-slate-100 transition-colors ${motionStudy.isActive ? 'text-amber-600' : 'text-emerald-600'}`}
                title={motionStudy.isActive ? "Pause" : "Play"}
             >
                {motionStudy.isActive ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                )}
             </button>
             <button onClick={handleStop} className="p-1 rounded hover:bg-slate-100 text-red-600 transition-colors" title="Stop">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
             </button>
             <div className="w-[1px] h-4 bg-slate-200 mx-1" />
             <button onClick={handleReset} className="p-1 rounded hover:bg-slate-100 text-slate-600 transition-colors" title="Reset">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
             </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 rounded text-[11px] font-mono font-bold text-slate-700 shadow-sm">
             T: {motionStudy.currentTime.toFixed(2)}s
          </div>
        </div>

        <div className="flex items-center gap-2">
           <span className="text-[10px] font-bold text-slate-400 uppercase">Speed</span>
           <select 
             value={motionStudy.playbackSpeed} 
             onChange={(e) => setMotionStudy({ playbackSpeed: parseFloat(e.target.value) })}
             className="bg-white border border-slate-200 rounded px-2 py-1 text-[11px] font-bold outline-none focus:border-blue-400"
           >
              <option value="0.5">0.5x</option>
              <option value="1">1.0x</option>
              <option value="2">2.0x</option>
              <option value="5">5.0x</option>
           </select>
           <button 
              onClick={() => setIsAddingDriver(true)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded font-bold text-[11px] hover:bg-blue-700 transition-all shadow-sm active:scale-95 uppercase tracking-tighter"
           >
             + Add Motor
           </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex gap-4 p-4">
        {/* Driver List */}
        <div className="w-1/3 bg-slate-50 border border-slate-200 rounded-lg p-2 flex flex-col gap-2 overflow-y-auto">
           <span className="text-[10px] font-bold text-slate-500 uppercase px-1">Active Drivers</span>
           {motionStudy.drivers.length === 0 && (
             <div className="text-[11px] text-slate-400 italic text-center py-4">No motors defined</div>
           )}
           {motionStudy.drivers.map(driver => (
             <div key={driver.id} className="bg-white border border-slate-200 rounded px-2 py-1.5 flex items-center justify-between shadow-sm animate-in slide-in-from-left-2">
                <div className="flex flex-col">
                   <span className="text-[11px] font-bold text-slate-700">Driver ({driver.mateId.slice(0,4)})</span>
                   <span className="text-[9px] font-mono text-slate-400 uppercase">{driver.type} @ {driver.velocity} {driver.type === 'ROTARY' ? 'deg/s' : 'mm/s'}</span>
                </div>
                <button 
                  onClick={() => removeMotionDriver(driver.id)}
                  className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-all"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
             </div>
           ))}
        </div>

        {/* Timeline Visualization (Simplified) */}
        <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg relative overflow-hidden flex flex-col p-2">
           <span className="text-[10px] font-bold text-slate-500 uppercase px-1">Kinematic Analysis</span>
           <div className="flex-1 mt-2 border-t border-slate-200 relative flex items-center">
              {/* Playhead */}
              <div 
                className="absolute top-0 bottom-0 w-[2px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] z-10 transition-all duration-75"
                style={{ left: `${(motionStudy.currentTime % 10) * 10}%` }}
              >
                <div className="w-2 h-2 bg-red-500 rounded-full absolute -top-1 -left-[3px]" />
              </div>
              
              {/* Grid Lines */}
              <div className="w-full h-full flex justify-between px-0 opacity-20 pointer-events-none">
                 {[...Array(11)].map((_, i) => (
                   <div key={i} className="h-full w-[1px] bg-slate-400" />
                 ))}
              </div>
           </div>
        </div>
      </div>

      {/* Add Driver Modal Overly */}
      {isAddingDriver && (
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-white/20">
              <div className="px-4 py-3 bg-blue-600 text-white flex items-center justify-between">
                 <h4 className="text-[13px] font-black uppercase tracking-tight">Add Motion Driver</h4>
                 <button onClick={() => setIsAddingDriver(false)} className="hover:rotate-90 transition-transform">
                   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                 </button>
              </div>
              <div className="p-6 space-y-4 text-slate-700">
                 <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Select Assembly Mate</label>
                    <select 
                      value={selectedMateId}
                      onChange={(e) => setSelectedMateId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-[12px] font-bold outline-none focus:border-blue-400"
                    >
                       <option value="">Choose a mate...</option>
                       {mates.filter(m => m.type === 'ANGLE' || m.type === 'DISTANCE').map(mate => (
                         <option key={mate.id} value={mate.id}>{mate.name} ({mate.type})</option>
                       ))}
                    </select>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                       <label className="text-[10px] font-bold text-slate-500 uppercase">Driver Type</label>
                       <div className="flex gap-2">
                          <button 
                            onClick={() => setDriverType('ROTARY')}
                            className={`flex-1 py-2 rounded border font-bold text-[11px] transition-all ${driverType === 'ROTARY' ? 'bg-blue-50 border-blue-600 text-blue-600' : 'bg-white border-slate-200 text-slate-400'}`}
                          >
                            Rotary
                          </button>
                          <button 
                            onClick={() => setDriverType('LINEAR')}
                            className={`flex-1 py-2 rounded border font-bold text-[11px] transition-all ${driverType === 'LINEAR' ? 'bg-blue-50 border-blue-600 text-blue-600' : 'bg-white border-slate-200 text-slate-400'}`}
                          >
                            Linear
                          </button>
                       </div>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-bold text-slate-500 uppercase">Velocity</label>
                       <div className="relative">
                          <input 
                            type="number"
                            value={velocity}
                            onChange={(e) => setVelocity(parseFloat(e.target.value))}
                            className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-[12px] font-bold outline-none focus:border-blue-400"
                          />
                          <span className="absolute right-3 top-2.5 text-[9px] font-black text-slate-400 uppercase">
                             {driverType === 'ROTARY' ? 'deg/s' : 'mm/s'}
                          </span>
                       </div>
                    </div>
                 </div>
                 <button 
                   disabled={!selectedMateId}
                   onClick={handleAddDriver}
                   className="w-full py-3 bg-blue-600 text-white rounded-lg font-black text-[13px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                 >
                   Establish Driver Link
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};
