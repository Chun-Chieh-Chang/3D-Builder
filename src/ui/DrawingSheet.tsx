'use client';

import React, { useEffect, useState } from 'react';
import { useCadStore } from '../store/useCadStore';
import { HeavyEngineClient } from '../kernel/HeavyEngineClient';

interface DrawingViewProps {
  title: string;
  type: 'FRONT' | 'TOP' | 'RIGHT' | 'ISO';
  lines: number[][][];
}

const DrawingView = ({ title, type, lines }: DrawingViewProps) => {
  const [editingDim, setEditingDim] = useState<'NONE' | 'HORIZ' | 'VERT'>('NONE');
  const [editValue, setEditValue] = useState<string>('');

  const features = useCadStore(state => state.features);
  const selectedId = useCadStore(state => state.selectedId);
  const updateFeatureParams = useCadStore(state => state.updateFeatureParams);

  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;
  lines.forEach(line => {
    line.forEach(p => {
      if (p[0] < minU) minU = p[0];
      if (p[0] > maxU) maxU = p[0];
      if (p[1] < minV) minV = p[1];
      if (p[1] > maxV) maxV = p[1];
    });
  });

  const hasBounds = minU !== Infinity && maxU !== -Infinity && minV !== Infinity && maxV !== -Infinity;
  const widthVal = hasBounds ? maxU - minU : 0;
  const heightVal = hasBounds ? maxV - minV : 0;
  const midU = hasBounds ? (minU + maxU) / 2 : 0;
  const midV = hasBounds ? (minV + maxV) / 2 : 0;

  const size = Math.max(widthVal, heightVal);
  const halfSize = hasBounds ? size / 2 + Math.max(size * 0.35, 15) : 50;
  const viewBox = hasBounds 
    ? `${midU - halfSize} ${midV - halfSize} ${halfSize * 2} ${halfSize * 2}`
    : "-50 -50 100 100";

  const viewBoxSize = halfSize * 2;
  const lineStrokeWidth = viewBoxSize * 0.005;
  const dimStrokeWidth = viewBoxSize * 0.0025;
  const textSize = viewBoxSize * 0.035;
  const rectW = viewBoxSize * 0.16;
  const rectH = viewBoxSize * 0.055;
  const extOffset = viewBoxSize * 0.18;
  const dimOffset = viewBoxSize * 0.13;

  const saveDimensionEdit = (dimType: 'HORIZ' | 'VERT') => {
    const newValue = parseFloat(editValue);
    setEditingDim('NONE');
    
    if (isNaN(newValue) || newValue <= 0) {
      return;
    }

    // Prioritize selected feature, fall back to first primary solid/sketch feature
    const primaryFeature = features.find(f => f.id === selectedId) || features.find(f => 
      f.type === 'BOX' || 
      f.type === 'CYLINDER' || 
      f.type === 'SPHERE' || 
      f.type === 'EXTRUDE'
    );

    if (!primaryFeature) {
      return;
    }

    const paramUpdates: Record<string, number> = {};
    const viewType = type;

    if (primaryFeature.type === 'BOX' || primaryFeature.type === 'EXTRUDE') {
      if (dimType === 'HORIZ') {
        if (viewType === 'FRONT' || viewType === 'TOP') {
          paramUpdates.width = newValue;
        } else if (viewType === 'RIGHT') {
          paramUpdates.depth = newValue;
        }
      } else if (dimType === 'VERT') {
        if (viewType === 'FRONT' || viewType === 'RIGHT') {
          paramUpdates.height = newValue;
        } else if (viewType === 'TOP') {
          paramUpdates.depth = newValue;
        }
      }
    } else if (primaryFeature.type === 'CYLINDER') {
      if (dimType === 'HORIZ') {
        paramUpdates.radius = newValue / 2;
      } else if (dimType === 'VERT') {
        if (viewType === 'FRONT' || viewType === 'RIGHT') {
          paramUpdates.height = newValue;
        } else if (viewType === 'TOP') {
          paramUpdates.radius = newValue / 2;
        }
      }
    } else if (primaryFeature.type === 'SPHERE') {
      paramUpdates.radius = newValue / 2;
    }

    if (Object.keys(paramUpdates).length > 0) {
      updateFeatureParams(primaryFeature.id, paramUpdates);
    }
  };

  return (
    <div className="border border-slate-300 bg-white aspect-video relative flex flex-col group hover:border-primary transition-all shadow-sm rounded overflow-hidden animate-fade-in">
      <div className="absolute top-2 left-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50/80 backdrop-blur px-1.5 py-0.5 rounded border border-slate-200 z-10 group-hover:text-primary group-hover:border-primary/30">
        {title} {hasBounds && type !== 'ISO' && `(${widthVal.toFixed(1)} x ${heightVal.toFixed(1)})`}
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        <svg viewBox={viewBox} className="w-full h-full text-slate-900 overflow-visible" style={{ transform: 'scaleY(-1)' }}>
          <defs>
            <marker id={`arrow-start-${type}`} viewBox="0 0 10 10" refX="0" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 10 0 L 0 5 L 10 10 z" fill="#3B82F6" />
            </marker>
            <marker id={`arrow-end-${type}`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#3B82F6" />
            </marker>
            <pattern id={`grid-${type}`} width={viewBoxSize * 0.1} height={viewBoxSize * 0.1} patternUnits="userSpaceOnUse">
              <path d={`M ${viewBoxSize * 0.1} 0 L 0 0 0 ${viewBoxSize * 0.1}`} fill="none" stroke="currentColor" strokeWidth={lineStrokeWidth * 0.2} className="opacity-10"/>
            </pattern>
          </defs>
          <rect x={midU - halfSize * 2} y={midV - halfSize * 2} width={halfSize * 4} height={halfSize * 4} fill={`url(#grid-${type})`} />
          
          {lines.length > 0 ? (
            lines.map((line, i) => (
              <polyline
                key={i}
                points={line.map(p => `${p[0]},${p[1]}`).join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth={lineStrokeWidth}
                className="group-hover:stroke-primary transition-colors"
              />
            ))
          ) : (
            <g transform="scale(1, -1)">
              <text x="0" y="0" textAnchor="middle" className="text-[6px] fill-slate-300 font-mono italic">
                GENERATING VIEW...
              </text>
            </g>
          )}

          {hasBounds && type !== 'ISO' && (
            <>
              {/* Horizontal Dimension */}
              <line
                x1={minU}
                y1={minV}
                x2={minU}
                y2={minV - extOffset}
                stroke="#64748B"
                strokeWidth={dimStrokeWidth}
                strokeDasharray={`${dimStrokeWidth * 2},${dimStrokeWidth}`}
              />
              <line
                x1={maxU}
                y1={minV}
                x2={maxU}
                y2={minV - extOffset}
                stroke="#64748B"
                strokeWidth={dimStrokeWidth}
                strokeDasharray={`${dimStrokeWidth * 2},${dimStrokeWidth}`}
              />
              <line
                x1={minU}
                y1={minV - dimOffset}
                x2={maxU}
                y2={minV - dimOffset}
                stroke="#3B82F6"
                strokeWidth={dimStrokeWidth}
                markerStart={`url(#arrow-start-${type})`}
                markerEnd={`url(#arrow-end-${type})`}
              />
              <g 
                transform={`translate(${midU}, ${minV - dimOffset}) scale(1, -1)`}
                className="cursor-pointer select-none"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingDim('HORIZ');
                  setEditValue(widthVal.toFixed(1));
                }}
              >
                <rect
                  x={-rectW / 2}
                  y={-rectH / 2}
                  width={rectW}
                  height={rectH}
                  fill="white"
                  stroke={editingDim === 'HORIZ' ? '#3B82F6' : '#E2E8F0'}
                  strokeWidth={editingDim === 'HORIZ' ? dimStrokeWidth : dimStrokeWidth / 2}
                  rx={rectH * 0.2}
                  className="hover:stroke-blue-500 hover:fill-blue-50/50 transition-all duration-200"
                />
                {editingDim === 'HORIZ' ? (
                  <foreignObject
                    x={-rectW / 2}
                    y={-rectH / 2}
                    width={rectW}
                    height={rectH}
                  >
                    <input
                      type="number"
                      step="any"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          saveDimensionEdit('HORIZ');
                        } else if (e.key === 'Escape') {
                          setEditingDim('NONE');
                        }
                      }}
                      onBlur={() => saveDimensionEdit('HORIZ')}
                      onDoubleClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="w-full h-full text-center font-mono font-bold text-slate-900 bg-white border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 select-all"
                      style={{
                        fontSize: `${textSize}px`,
                        padding: 0,
                        margin: 0,
                        border: 'none',
                        outline: 'none',
                        background: 'transparent'
                      }}
                    />
                  </foreignObject>
                ) : (
                  <text
                    x="0"
                    y={rectH * 0.18}
                    textAnchor="middle"
                    fontSize={textSize}
                    fontWeight="bold"
                    fill="#1E293B"
                    fontFamily="monospace"
                    className="pointer-events-none hover:fill-blue-600"
                  >
                    {widthVal.toFixed(1)}
                  </text>
                )}
              </g>

              {/* Vertical Dimension */}
              <line
                x1={minU}
                y1={minV}
                x2={minU - extOffset}
                y2={minV}
                stroke="#64748B"
                strokeWidth={dimStrokeWidth}
                strokeDasharray={`${dimStrokeWidth * 2},${dimStrokeWidth}`}
              />
              <line
                x1={minU}
                y1={maxV}
                x2={minU - extOffset}
                y2={maxV}
                stroke="#64748B"
                strokeWidth={dimStrokeWidth}
                strokeDasharray={`${dimStrokeWidth * 2},${dimStrokeWidth}`}
              />
              <line
                x1={minU - dimOffset}
                y1={minV}
                x2={minU - dimOffset}
                y2={maxV}
                stroke="#3B82F6"
                strokeWidth={dimStrokeWidth}
                markerStart={`url(#arrow-start-${type})`}
                markerEnd={`url(#arrow-end-${type})`}
              />
              <g 
                transform={`translate(${minU - dimOffset}, ${midV}) scale(1, -1)`}
                className="cursor-pointer select-none"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingDim('VERT');
                  setEditValue(heightVal.toFixed(1));
                }}
              >
                <rect
                  x={-rectW / 2}
                  y={-rectH / 2}
                  width={rectW}
                  height={rectH}
                  fill="white"
                  stroke={editingDim === 'VERT' ? '#3B82F6' : '#E2E8F0'}
                  strokeWidth={editingDim === 'VERT' ? dimStrokeWidth : dimStrokeWidth / 2}
                  rx={rectH * 0.2}
                  className="hover:stroke-blue-500 hover:fill-blue-50/50 transition-all duration-200"
                />
                {editingDim === 'VERT' ? (
                  <foreignObject
                    x={-rectW / 2}
                    y={-rectH / 2}
                    width={rectW}
                    height={rectH}
                  >
                    <input
                      type="number"
                      step="any"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          saveDimensionEdit('VERT');
                        } else if (e.key === 'Escape') {
                          setEditingDim('NONE');
                        }
                      }}
                      onBlur={() => saveDimensionEdit('VERT')}
                      onDoubleClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="w-full h-full text-center font-mono font-bold text-slate-900 bg-white border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 select-all"
                      style={{
                        fontSize: `${textSize}px`,
                        padding: 0,
                        margin: 0,
                        border: 'none',
                        outline: 'none',
                        background: 'transparent'
                      }}
                    />
                  </foreignObject>
                ) : (
                  <text
                    x="0"
                    y={rectH * 0.18}
                    textAnchor="middle"
                    fontSize={textSize}
                    fontWeight="bold"
                    fill="#1E293B"
                    fontFamily="monospace"
                    className="pointer-events-none hover:fill-blue-600"
                  >
                    {heightVal.toFixed(1)}
                  </text>
                )}
              </g>
            </>
          )}
        </svg>
      </div>
    </div>
  );
};

export const DrawingSheet = () => {
  const { components, features, mode, projectName, drawingScale, drawnBy, approvedBy } = useCadStore();
  const [projections, setProjections] = useState<{ [key: string]: number[][][] }>({
    FRONT: [],
    TOP: [],
    RIGHT: [],
    ISO: []
  });
  const [isRebuilding, setIsRebuilding] = useState<boolean>(false);

  useEffect(() => {
    const fetchProjections = async () => {
      setIsRebuilding(true);
      const client = HeavyEngineClient.getInstance();
      const views = ['FRONT', 'TOP', 'RIGHT', 'ISO'];
      const newProjections: any = { ...projections };

      for (const view of views) {
        try {
          const lines = await client.project(features, view);
          newProjections[view] = lines;
        } catch (e) {
          console.error(`Failed to fetch projection for ${view}`, e);
        }
      }
      
      setProjections(newProjections);
      setIsRebuilding(false);
    };

    if (features.length > 0) {
      fetchProjections();
    }
  }, [features]);

  return (
    <div className="flex-1 h-full bg-[#CBD5E1] p-8 overflow-auto flex justify-center">
      <div id="drawing-sheet-container" className="w-[1120px] h-[792px] bg-white shadow-2xl border-2 border-slate-400 relative flex flex-col p-12 space-y-6">
        
        {isRebuilding && (
          <div className="absolute top-6 right-12 bg-blue-500/90 border border-blue-400 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 z-[999] backdrop-blur-md transition-all animate-pulse">
            <span className="text-sm">🔄</span>
            <span className="text-[11px] font-extrabold uppercase tracking-wider">雙向參數重構中 (Rebuilding...)</span>
          </div>
        )}

        <div className="flex justify-between items-start border-b-2 border-slate-900 pb-2">
          <div className="flex flex-col">
            <span className="text-2xl font-black tracking-tighter text-slate-900 uppercase">Engineering Drawing</span>
            <span className="text-sm font-bold text-slate-500">PROJECT: {projectName || 'Professional CAD Project'}</span>
          </div>
          <div className="text-right flex flex-col">
            <span className="text-xs font-bold text-slate-400 uppercase">Standard</span>
            <span className="text-sm font-bold text-slate-900">ISO 128 (GPS)</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 flex-1 min-h-0">
          <DrawingView title="Front Elevation" type="FRONT" lines={projections.FRONT} />
          <DrawingView title="Top Plan" type="TOP" lines={projections.TOP} />
          <DrawingView title="Right Profile" type="RIGHT" lines={projections.RIGHT} />
          <DrawingView title="Isometric View" type="ISO" lines={projections.ISO} />
        </div>

        {(mode === 'ASSEMBLY' || components.length > 0) && (
          <div className="mt-2 border-2 border-slate-900 p-3 max-h-[120px] overflow-auto">
            <div className="text-[10px] font-black uppercase mb-1 bg-slate-900 text-white px-2 py-0.5 inline-block">Bill of Materials (BOM)</div>
            <table className="w-full text-left text-[10px]">
              <thead>
                <tr className="border-b border-slate-300 text-slate-500 uppercase font-bold">
                  <th className="py-0.5">Item No.</th>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th className="text-right">QTY</th>
                </tr>
              </thead>
              <tbody>
                {components.length > 0 ? (
                  components.reduce((acc: any[], comp) => {
                    const existing = acc.find(item => item.partId === comp.partId);
                    if (existing) {
                      existing.qty += 1;
                    } else {
                      acc.push({ partId: comp.partId, name: comp.instanceName, qty: 1 });
                    }
                    return acc;
                  }, []).map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="py-1 font-bold">{idx + 1}</td>
                      <td>{item.partId}</td>
                      <td>{item.name}</td>
                      <td className="text-right font-mono">{item.qty}</td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-b border-slate-100">
                    <td className="py-1 font-bold">1</td>
                    <td>PART-001</td>
                    <td>{projectName || 'Current Part'}</td>
                    <td className="text-right font-mono">1</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-auto pt-3 border-t-2 border-slate-900 grid grid-cols-4 gap-4 text-xs font-bold text-slate-800 uppercase">
          <div className="flex flex-col border-r border-slate-200 pr-4">
            <span className="text-[9px] text-slate-400 font-bold">PROJECT NAME</span>
            <span className="text-xs font-black text-slate-900 truncate">{projectName || 'Professional CAD Project'}</span>
          </div>
          <div className="flex flex-col border-r border-slate-200 px-4">
            <span className="text-[9px] text-slate-400 font-bold">DESIGNED BY</span>
            <span className="text-xs font-extrabold text-slate-900">{drawnBy || 'CAD Engineer'}</span>
          </div>
          <div className="flex flex-col border-r border-slate-200 px-4">
            <span className="text-[9px] text-slate-400 font-bold">APPROVED BY</span>
            <span className="text-xs font-extrabold text-slate-900">{approvedBy || 'Lead Architect'}</span>
          </div>
          <div className="flex justify-between items-center pl-4">
            <div className="flex flex-col">
              <span className="text-[9px] text-slate-400 font-bold">SCALE</span>
              <span className="text-xs font-black text-primary">{drawingScale || '1:1'}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[9px] text-slate-400 font-bold">SHEET</span>
              <span className="text-xs font-extrabold text-slate-900">1 OF 1</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
