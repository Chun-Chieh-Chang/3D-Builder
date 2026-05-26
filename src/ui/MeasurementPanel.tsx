/**

 * Measurement Panel

 * 顯示測量結果的 PropertyManager 面板

 * 對標 SolidWorks Evaluate > Measure 

 */



import React from 'react';

import { useCadStore, type MeasurementMode, type MeasurementResult } from '../store/useCadStore';

import { MeasurementService } from '../kernel/MeasurementService';



export const MeasurementPanel = () => {

  const {

    measurementMode,

    measurementPoints,

    measurementResults,

    setMeasurementMode,

    setMeasurementPoints,

    setMeasurementResults,

  } = useCadStore();



  const measurementService = new MeasurementService();



  // 

  const handleClearSelection = () => {

    setMeasurementMode('NONE');

    setMeasurementPoints([]);

    setMeasurementResults(null);

  };



  // 

  const handleModeChange = (mode: MeasurementMode) => {

    setMeasurementMode(mode);

    setMeasurementPoints([]);

    setMeasurementResults(null);

  };



  // 

  const formatPoint = (point: any, index: number) => {

    if (!point || !point.coordinates) return null;

    const [x, y, z] = point.coordinates;

    return (

      <div key={`point_${index}`} className="flex items-center gap-2 p-1.5 bg-[#F8FAFC] rounded text-[13px]"> <span className="font-bold text-primary">M{index + 1}</span> <span className="font-mono text-slate-600">

          [{x.toFixed(2)}, {y.toFixed(2)}, {z.toFixed(2)}]

        </span> </div>

    );

  };



  // 

  const getModeInstructions = () => {

    switch (measurementMode) {

      case 'DISTANCE':

        return '';

      case 'ANGLE':

        return '';

      case 'AREA':

        return '';

      case 'VOLUME':

        return '';

      default:

        return '';

    }

  };



  return (

    <div className="p-2.5 bg-white rounded-xl border border-[#D1D5DB] shadow-sm space-y-3">

      {/* Panel Header */}

      <div className="text-[14px] text-slate-700 font-bold uppercase border-b border-[#D1D5DB]/50 pb-1 flex justify-between items-center"> <span className="flex items-center gap-1"> </span> <span className="text-[13px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-mono">MEASURE</span> </div>



      {/* Mode Selection */}

      <div className="grid grid-cols-2 gap-1.5"> <button

          onClick={() => handleModeChange('DISTANCE')}

          className={`flex items-center justify-center gap-1.5 p-1.5 rounded border text-[13px] font-bold transition-all ${

            measurementMode === 'DISTANCE'

              ? 'bg-primary/10 border-primary text-primary shadow-sm'

              : 'bg-[#F8FAFC] border-slate-200 text-slate-700 hover:bg-slate-100'

          }`}

        >

          <span> </span> <span>距離</span> </button> <button

          onClick={() => handleModeChange('ANGLE')}

          className={`flex items-center justify-center gap-1.5 p-1.5 rounded border text-[13px] font-bold transition-all ${

            measurementMode === 'ANGLE'

              ? 'bg-primary/10 border-primary text-primary shadow-sm'

              : 'bg-[#F8FAFC] border-slate-200 text-slate-700 hover:bg-slate-100'

          }`}

        >

          <span> </span> <span> </span> </button> <button

          onClick={() => handleModeChange('AREA')}

          className={`flex items-center justify-center gap-1.5 p-1.5 rounded border text-[13px] font-bold transition-all ${

            measurementMode === 'AREA'

              ? 'bg-primary/10 border-primary text-primary shadow-sm'

              : 'bg-[#F8FAFC] border-slate-200 text-slate-700 hover:bg-slate-100'

          }`}

        >

          <span> </span> <span> </span> </button> <button

          onClick={() => handleModeChange('VOLUME')}

          className={`flex items-center justify-center gap-1.5 p-1.5 rounded border text-[13px] font-bold transition-all ${

            measurementMode === 'VOLUME'

              ? 'bg-primary/10 border-primary text-primary shadow-sm'

              : 'bg-[#F8FAFC] border-slate-200 text-slate-700 hover:bg-slate-100'

          }`}

        >

          <span> </span> <span>體積</span> </button> </div>



      {/* Instructions */}

      <div className="p-2 bg-[#F8FAFC] rounded text-[13px] text-slate-600 leading-tight">

        {getModeInstructions()}

      </div>



      {/* Selected Points */}

      {measurementPoints.length > 0 && (

        <div className="space-y-1.5"> <div className="text-[13px] text-slate-500 font-bold uppercase">:</div>

          {measurementPoints.map((point, index) => formatPoint(point, index))}

        </div>

      )}



      {/* Measurement Results */}

      {measurementResults && (

        <div className="p-3 bg-[#ECFDF5] rounded border border-[#10B981]/20 space-y-2"> <div className="text-[13px] text-[#059669] font-bold uppercase">測量結果:</div> <div className="flex items-center justify-between"> <span className="text-[13px] text-slate-600 font-bold">類型:</span> <span className="text-[13px] text-[#059669] font-bold uppercase">
                {measurementResults.mode === 'DISTANCE' ? '距離' : 
                 measurementResults.mode === 'ANGLE' ? '角度' : 
                 measurementResults.mode === 'AREA' ? '表面積' : 
                 measurementResults.mode === 'VOLUME' ? '體積' : 
                 measurementResults.mode}
              </span> </div> <div className="flex items-center justify-between"> <span className="text-[13px] text-slate-600 font-bold">數值:</span> <span className="text-[16px] text-[#059669] font-bold font-mono">
              {(measurementResults.value ?? 0).toFixed(3)} {measurementResults.unit}
            </span> </div>

          {measurementResults.details && (

            <div className="text-[12px] text-slate-500 italic">

              {measurementResults.details}

            </div>

          )}

        </div>

      )}



      {/* Clear Button */}

      {(measurementMode !== 'NONE' || measurementPoints.length > 0) && (

        <button

          onClick={handleClearSelection}

          className="w-full flex items-center justify-center gap-1.5 p-2 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#EF4444] rounded border border-[#E2E8F0] text-[13px] font-bold transition-all"

        > <span> </span> <span> </span> </button>

      )}

    </div>

  );

};

