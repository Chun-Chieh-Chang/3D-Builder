'use client';



import React, { useMemo } from 'react';

import { useCadStore } from '../store/useCadStore';

import { analyzeSketchDefinitions } from '../utils/geometry/ConstraintSolver';



export const StatusBar: React.FC = () => {

  const { 

    isSketchMode, 

    sketchNodes, 

    sketchEdges, 

    sketchConstraints,

    mousePos,

    hint,

    activePlane

  } = useCadStore();



  const definitionReport = useMemo(() => {

    if (!isSketchMode) return null;

    return analyzeSketchDefinitions(sketchNodes, sketchEdges, sketchConstraints);

  }, [isSketchMode, sketchNodes, sketchEdges, sketchConstraints]);



  const definitionStatus = useMemo(() => {

    if (!isSketchMode || !definitionReport) return null;

    

    if (definitionReport.hasConflict) {

      return { text: ' (Over Defined)', color: 'text-red-500 font-black' };

    }



    const nodeIds = Object.keys(sketchNodes);

    if (nodeIds.length === 0) return { text: ' (Empty)', color: 'text-slate-400' };



    const isFullyDefined = nodeIds.every(id => definitionReport.nodes[id] === 'FULLY');

    

    if (isFullyDefined) {

      return { text: 'Fully Defined', color: 'text-slate-800 font-bold' };

    } else {

      return { text: 'Under Defined', color: 'text-blue-500 font-bold' };

    }

  }, [isSketchMode, sketchNodes, definitionReport]);



  return (

    <footer className="h-[28px] w-full bg-[#F5F6F9] border-t border-[#D1D5DB] flex items-center justify-between px-3 text-[12px] text-slate-600 select-none z-50 shrink-0 font-sans">

      {/* Left: Hint & Mode */}

      <div className="flex items-center gap-4 min-w-0 flex-1"> <div className="flex items-center gap-2 shrink-0"> <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]"></span> <span className="font-bold text-slate-700 truncate max-w-[300px]" title={hint}>{hint}</span> </div>

        

        {isSketchMode && (

          <div className="flex items-center gap-2 px-3 border-l border-slate-300"> <span className="text-[11px] text-slate-400 font-bold uppercase tracking-tighter">Sketch Status:</span> <span className={definitionStatus?.color}>{definitionStatus?.text}</span> </div>

        )}

      </div>



      {/* Right: Coordinates & Units */}

      <div className="flex items-center gap-6 shrink-0 font-mono">

        {mousePos && (

          <div className="flex items-center gap-3 text-slate-500"> <div className="flex items-center gap-1"> <span className="text-[10px] font-black text-slate-300">X:</span> <span className="w-[50px] text-right">{mousePos[0].toFixed(2)}</span> </div> <div className="flex items-center gap-1"> <span className="text-[10px] font-black text-slate-300">Y:</span> <span className="w-[50px] text-right">{mousePos[1].toFixed(2)}</span> </div> <div className="flex items-center gap-1"> <span className="text-[10px] font-black text-slate-300">Z:</span> <span className="w-[50px] text-right">{mousePos[2].toFixed(2)}</span> </div> </div>

        )}



        <div className="flex items-center gap-2 px-3 border-l border-slate-300"> <span className="font-black text-slate-800">MMGS</span> <span className="text-[11px] text-slate-400">(mm, g, s)</span> <span className="cursor-pointer hover:text-primary transition-colors ml-1"> </span> </div> <div className="flex items-center gap-2 px-3 border-l border-slate-300"> <span className="font-bold text-slate-500">{isSketchMode ? (activePlane === 'FACE' ? '' : activePlane) : 'Part'}</span> </div> </div> </footer>

  );

};

