import { useCadStore, SketchNode, SketchEdge, SketchConstraint } from './useCadStore';
import { requireValidPoint } from '../utils/sketch/DataIntegrity';
import { v4 as uuidv4 } from 'uuid';

/**
 * Command Center for all Sketch Mutations.
 * Do not modify sketchNodes/sketchEdges/sketchConstraints directly from UI components.
 * Always dispatch through these actions to guarantee Data Integrity and Cascading Deletes.
 */

const gc = (nodes: Record<string, SketchNode>, edges: Record<string, SketchEdge>, constraints: Record<string, SketchConstraint>) => {
  let changed = false;
  // 1. Find orphan nodes
  const usedNodeIds = new Set<string>();
  Object.values(edges).forEach((edge: any) => {
    edge.nodeIds.forEach((nid: string) => usedNodeIds.add(nid));
  });

  Object.values(nodes).forEach((node: any) => {
    if (!usedNodeIds.has(node.id) && !node.isFixed) {
      delete nodes[node.id];
      changed = true;
    }
  });

  // 2. Find invalid constraints (referencing missing edges or nodes)
  Object.values(constraints).forEach((c: any) => {
    let invalid = false;
    if (c.edgeIds?.some((eid: string) => !edges[eid])) invalid = true;
    if (c.nodeIds?.some((nid: string) => !nodes[nid])) invalid = true;
    if (invalid) {
      delete constraints[c.id];
      changed = true;
    }
  });

  return changed;
};

export const sketchActions = {
  addNode: (u: number, v: number, isFixed: boolean = false): string | null => {
    if (!requireValidPoint(u, v, 'addNode')) return null;
    
    const state = useCadStore.getState();
    const nId = uuidv4();
    const newNode: SketchNode = { id: nId, x: u, y: v, isFixed };
    
    useCadStore.setState({
      sketchNodes: { ...state.sketchNodes, [nId]: newNode }
    });
    
    return nId;
  },

  addEdge: (type: 'LINE' | 'ARC' | 'SPLINE' | 'CIRCLE' | 'CENTER_LINE', nodeIds: string[]): string => {
    const state = useCadStore.getState();
    const eId = uuidv4();
    const newEdge: SketchEdge = { 
      id: eId, 
      type: type === 'CENTER_LINE' ? 'LINE' : type, 
      nodeIds,
      isConstruction: type === 'CENTER_LINE'
    };
    
    useCadStore.setState({
      sketchEdges: { ...state.sketchEdges, [eId]: newEdge }
    });
    
    return eId;
  },

  addConstraint: (type: string, edgeIds: string[] = [], nodeIds: string[] = [], value?: number): string => {
    const state = useCadStore.getState();
    const cId = uuidv4();
    const newConstraint: SketchConstraint = { id: cId, type: type as any, edgeIds, nodeIds, value };
    
    useCadStore.setState({
      sketchConstraints: { ...state.sketchConstraints, [cId]: newConstraint }
    });
    
    return cId;
  },

  deleteEdges: (edgeIdsToDelete: string[]) => {
    const state = useCadStore.getState();
    const nextEdges = { ...state.sketchEdges };
    const nextNodes = { ...state.sketchNodes };
    const nextConstraints = { ...state.sketchConstraints };

    edgeIdsToDelete.forEach(id => delete nextEdges[id]);

    gc(nextNodes, nextEdges, nextConstraints);

    useCadStore.setState({
      sketchEdges: nextEdges,
      sketchNodes: nextNodes,
      sketchConstraints: nextConstraints,
    });
  },

  deleteNodes: (nodeIdsToDelete: string[]) => {
    const state = useCadStore.getState();
    const nextNodes = { ...state.sketchNodes };
    const nextEdges = { ...state.sketchEdges };
    const nextConstraints = { ...state.sketchConstraints };
    
    // 1. Delete the explicitly requested nodes
    nodeIdsToDelete.forEach(id => delete nextNodes[id]);

    // 2. Delete edges that reference missing nodes
    Object.values(nextEdges).forEach((edge: any) => {
      if (edge.nodeIds.some((nid: string) => !nextNodes[nid])) {
        delete nextEdges[edge.id];
      }
    });

    // 3. Garbage collect orphan nodes and invalid constraints
    gc(nextNodes, nextEdges, nextConstraints);

    useCadStore.setState({
      sketchNodes: nextNodes,
      sketchEdges: nextEdges,
      sketchConstraints: nextConstraints,
    });
  },

  deleteEntities: (entityIds: string[]) => {
    const state = useCadStore.getState();
    const nextNodes = { ...state.sketchNodes };
    const nextEdges = { ...state.sketchEdges };
    const nextConstraints = { ...state.sketchConstraints };

    entityIds.forEach(id => {
      if (nextNodes[id]) delete nextNodes[id];
      if (nextEdges[id]) delete nextEdges[id];
      if (nextConstraints[id]) delete nextConstraints[id];
    });

    // Delete edges that reference missing nodes
    Object.values(nextEdges).forEach((edge: any) => {
      if (edge.nodeIds.some((nid: string) => !nextNodes[nid])) {
        delete nextEdges[edge.id];
      }
    });

    gc(nextNodes, nextEdges, nextConstraints);

    useCadStore.setState({
      sketchNodes: nextNodes,
      sketchEdges: nextEdges,
      sketchConstraints: nextConstraints,
    });
  },

  updateNodePosition: (nodeId: string, u: number, v: number) => {
    if (!requireValidPoint(u, v, 'updateNodePosition')) return;
    const state = useCadStore.getState();
    if (state.sketchNodes[nodeId]) {
      useCadStore.setState({
        sketchNodes: { 
          ...state.sketchNodes, 
          [nodeId]: { ...state.sketchNodes[nodeId], x: u, y: v } 
        }
      });
    }
  },
  
  commitBatch: (
    newNodes: Record<string, SketchNode>,
    newEdges: Record<string, SketchEdge>,
    newConstraints: Record<string, SketchConstraint>
  ) => {
    useCadStore.setState({
      sketchNodes: newNodes,
      sketchEdges: newEdges,
      sketchConstraints: newConstraints
    });
  }
};
