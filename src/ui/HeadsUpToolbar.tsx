'use client';

import React, { useState } from 'react';
import { useCadStore } from '../store/useCadStore';

const ZoomIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    <path d="M8 11h6" /><path d="M11 8v6" />
  </svg>
);

const ViewIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" />
  </svg>
);

const StyleIcon = ({ wireframe }: { wireframe?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    {wireframe ? (
      <g>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
      </g>
    ) : (
      <path d="M12 22.08V12L3.27 6.96" />
    )}
  </svg>
);

const SectionIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3h18v18H3z" /><path d="M3 12h18" /><path d="M12 3v18" />
  </svg>
);

export const HeadsUpToolbar: React.FC = () => {
  const { triggerCameraNormal, setActivePlane, controls } = useCadStore();
  const [showOrientation, setShowOrientation] = useState(false);
  const [displayStyle, setDisplayStyle] = useState<'SHADED' | 'WIREFRAME'>('SHADED');

  const handleZoomToFit = () => { if (controls) controls.reset(); };

  const setOrientation = (view: 'FRONT' | 'TOP' | 'RIGHT' | 'ISOMETRIC' | 'NORMAL_TO') => {
    if (view === 'ISOMETRIC') {
      if (controls) {
        controls.object.position.set(150, 150, 150);
        controls.target.set(0, 0, 0);
        controls.update();
      }
    } else if (view === 'NORMAL_TO') {
      triggerCameraNormal();
    } else {
      // Just trigger camera alignment without changing the activePlane of the model
      // We'll use a temporary plane override for the trigger if needed, or just let triggerCameraNormal handle it.
      // For now, let's keep the activePlane logic but maybe it should be renamed to activeView if it's just for orientation.
      // However, in this app activePlane is used for sketching.
      // So let's make it so that if we are NOT in sketch mode, we can change activePlane to align view.
      setActivePlane(view);
      triggerCameraNormal();
    }
    setShowOrientation(false);
  };

  return (
    <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-1 p-2 bg-surface border border-white/30 rounded-sm shadow-sm z-40 select-none transition-all hover:bg-white/60 font-sans">
      <button onClick={handleZoomToFit} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-background text-slate-800 transition-all " title="Zoom to Fit (F)">
        <ZoomIcon />
      </button>

      <div className="relative">
        <button onClick={() => setShowOrientation(!showOrientation)} className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all  ${showOrientation ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'hover:bg-background text-slate-800'}`} title="View Orientation">
          <ViewIcon />
        </button>

        {showOrientation && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-48 bg-white/90 backdrop-blur-2xl border border-white/50 rounded-sm shadow-sm py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            {[
              { id: 'NORMAL_TO', label: 'Normal To', key: 'N', color: 'bg-slate-700' },
              { id: 'FRONT', label: 'Front View', key: 'F', color: 'bg-blue-500' },
              { id: 'TOP', label: 'Top View', key: 'T', color: 'bg-green-500' },
              { id: 'RIGHT', label: 'Right View', key: 'R', color: 'bg-red-500' },
              { id: 'ISOMETRIC', label: 'Isometric', key: 'I', color: 'bg-purple-500' }
            ].map((v) => (
              <button key={v.id} onClick={() => setOrientation(v.id as any)} className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-all flex items-center gap-3 border-none bg-transparent cursor-pointer">
                <span className={`w-5 h-5 ${v.color} text-white rounded-md flex items-center justify-center text-[10px] shadow-sm font-black`}>{v.key}</span>
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-[1px] h-6 bg-slate-300/30 mx-1" />

      <button onClick={() => setDisplayStyle(displayStyle === 'SHADED' ? 'WIREFRAME' : 'SHADED')} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-background text-slate-800 transition-all " title="Display Style">
        <StyleIcon wireframe={displayStyle === 'WIREFRAME'} />
      </button>

      <button className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-background text-slate-800 transition-all opacity-40 cursor-not-allowed" title="Section View (Under Dev)">
        <SectionIcon />
      </button>
    </div>
  );
};
