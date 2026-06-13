'use client';

import React, { useEffect, useRef } from 'react';
import { useCadStore } from '../store/useCadStore';

export const RobotHUD: React.FC = () => {
  const { 
    automationLog, 
    activeAutomationStep, 
    robotStatus,
    setRobotStatus 
  } = useCadStore();
  
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [automationLog]);

  if (robotStatus === 'IDLE' && automationLog.length === 0) return null;

  return (
    <div className="fixed right-6 top-24 w-80 bg-slate-900/90 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[5000] animate-in slide-in-from-right-4 duration-300">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-600 to-amber-500 p-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full bg-white ${robotStatus === 'WORKING' ? 'animate-ping' : ''}`} />
          <span className="text-[11px] font-black text-white uppercase tracking-wider">Robot Operation HUD</span>
        </div>
        <span className="text-[9px] font-bold text-amber-100 bg-white/10 px-2 py-0.5 rounded-full">{robotStatus}</span>
      </div>

      {/* Active Step */}
      <div className="p-4 bg-white/5 border-b border-white/10">
        <label className="text-[9px] font-black text-amber-400 uppercase mb-1 block tracking-tighter">Active Command</label>
        <div className="text-[13px] font-bold text-white leading-tight">
          {activeAutomationStep || 'Waiting for instructions...'}
        </div>
        {robotStatus === 'WORKING' && (
          <div className="mt-3 h-1 w-full bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 animate-progress-indefinite" style={{ width: '40%' }} />
          </div>
        )}
      </div>

      {/* Operation Log */}
      <div className="flex-1 max-h-60 overflow-y-auto p-3 space-y-2 custom-scrollbar bg-black/20">
        {automationLog.map((log, idx) => (
          <div key={idx} className="flex gap-2 text-[11px] font-mono leading-relaxed group">
            <span className="text-slate-500 shrink-0">[{idx+1}]</span>
            <span className="text-slate-300 break-words group-last:text-amber-300 group-last:font-bold">{log}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* Footer Controls */}
      <div className="p-3 bg-white/5 flex gap-2">
        <button 
          onClick={() => useCadStore.getState().setRobotStatus('IDLE')}
          className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-black rounded transition-colors"
        >
          DISMISS
        </button>
      </div>

      <style jsx>{`
        @keyframes progress-indefinite {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        .animate-progress-indefinite {
          animation: progress-indefinite 1.5s infinite linear;
        }
      `}</style>
    </div>
  );
};
