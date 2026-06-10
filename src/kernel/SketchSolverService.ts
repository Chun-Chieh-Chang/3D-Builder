import {
  solveConstraints,
  analyzeSketchDefinitions,
} from '@/utils/geometry/ConstraintSolver';
import { HeavyEngineClient } from '@/kernel/HeavyEngineClient';
import { useCadStore } from '@/store/useCadStore';
import type { SketchConstraint, SketchEdge, SketchNode } from '@/store/useCadStore';
import { extractAllClosedLoops } from '@/utils/geometry/GraphAdapter';

export interface SketchSolveReport {
  dof: number;
  residual: number;
  status: string;
  nodes?: Record<string, any>;
}

/** PBD preview during drag / line chaining (60 FPS target). */
export function previewSolve(
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>,
  constraints: Record<string, SketchConstraint>,
  iterations = 8,
): Record<string, SketchNode> {
  return solveConstraints(nodes, edges, constraints, iterations);
}

/** Newton-Raphson via Python backend; falls back to extended local PBD. */
export async function preciseSolve(
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>,
  constraints: Record<string, SketchConstraint>,
): Promise<{ nodes: Record<string, SketchNode>; report: SketchSolveReport }> {
  const client = HeavyEngineClient.getInstance();
  const alive = await client.checkHealth();

  if (alive) {
    try {
      const result = await client.solveSketch(nodes, edges, constraints);
      if (result?.nodes) {
        return {
          nodes: result.nodes as Record<string, SketchNode>,
          report: {
            dof: Number(result.report?.dof ?? 0),
            residual: Number(result.report?.residual ?? 0),
            status: String(result.report?.status ?? 'SOLVED'),
          },
        };
      }
    } catch (err) {
      console.warn('[SketchSolverService] Backend precise solve failed:', err);
    }
  }

  const solved = solveConstraints(nodes, edges, constraints, 30);
  const analysis = analyzeSketchDefinitions(solved, edges, constraints);
  let residual = 0;
  for (const c of Object.values(constraints)) {
    if (c.type === 'DISTANCE' && c.nodeIds?.length === 2 && c.value !== undefined) {
      const n1 = solved[c.nodeIds[0]];
      const n2 = solved[c.nodeIds[1]];
      if (n1 && n2) {
        residual = Math.max(
          residual,
          Math.abs(Math.hypot(n2.x - n1.x, n2.y - n1.y) - c.value),
        );
      }
    }
  }

  return {
    nodes: solved,
    report: {
      dof: analysis.dof,
      residual,
      status: 'LOCAL_FALLBACK',
    },
  };
}

/** Commits precise solve into Zustand (call on mouse-up / constraint commit). */
export async function commitPreciseSketchSolve(): Promise<SketchSolveReport> {
  const state = useCadStore.getState();
  const { nodes, report } = await preciseSolve(
    state.sketchNodes,
    state.sketchEdges,
    state.sketchConstraints,
  );
  
  useCadStore.setState({
    sketchNodes: nodes,
    solverReport: { 
      dof: report.dof, 
      residual: report.residual,
      nodes: report.nodes || {}
    },
  });

  const editingFeatureId = state.editingFeatureId;
  if (editingFeatureId) {
    const feature = state.features.find(f => f.id === editingFeatureId);
    if (feature) {
      const solidLoops = extractAllClosedLoops(nodes, state.sketchEdges);
      const nextParams = {
        ...feature.parameters,
        points: solidLoops,
        sketchNodes: { ...nodes },
      };
      state.updateFeatureParams(editingFeatureId, nextParams);
      const featIndex = state.features.findIndex(f => f.id === editingFeatureId);
      state.markRebuildDirty(featIndex >= 0 ? featIndex : 0);
    }
  }

  return report;
}

