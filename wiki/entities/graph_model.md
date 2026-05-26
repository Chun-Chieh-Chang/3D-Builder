# Graph-based Sketch Data Model

The core sketch engine of **3D-Builder** was refactored on **2026-05-23** from sequential point lists to a robust, graph-based topological data structure managed globally by Zustand.

---

## 1. Data Structure Specifications

The graph topology is defined by three main tables inside `src/store/useCadStore.ts`:

### A. Sketch Nodes (Vertices)
Nodes represent the geometric coordinates of sketch endpoints, centers, or control handles.
```typescript
export interface SketchNode {
  id: string;
  x: number;      // 2D Local Coordinate System Coordinate (X)
  y: number;      // 2D Local Coordinate System Coordinate (Y)
  isFixed?: boolean; // Set to true to lock the node in position (anchoring weights in PBD solver)
}
```

### B. Sketch Edges
Edges represent the lines or curves that connect nodes to form the sketch geometry.
```typescript
export type SketchEdgeType = 'LINE' | 'ARC' | 'CIRCLE' | 'CENTER_LINE';

export interface SketchEdge {
  id: string;
  type: SketchEdgeType;
  nodeIds: string[];      // Array of node IDs forming the edge (e.g. [nodeA, nodeB])
  isConstruction?: boolean; // True if the line is for reference (construction lines)
}
```

### C. Sketch Constraints
Constraints link nodes and/or edges to define parametric rules that the geometry must satisfy.
```typescript
export type ConstraintType = 'COINCIDENT' | 'HORIZONTAL' | 'VERTICAL' | 'DISTANCE' | 'EQUAL';

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  nodeIds?: string[];      // Involved nodes (e.g., COINCIDENT connects 2 nodes)
  edgeIds?: string[];      // Involved edges (e.g., HORIZONTAL affects 1 edge)
  value?: number;          // Numeric value (used for absolute DISTANCE constraints)
}
```

---

## 2. Dynamic Selection State
To perform CAD editing and apply constraints, the UI tracks selections under:
*   `selectedEntityIds: string[]`: Contains the active list of selected node and edge IDs.
*   `selectedTopology`: Tracks selected 3D entities (faces/edges) for Reference Geometry or "Sketch on Face" operations.

---

## 3. Reference Implementation
*   **Zustand Store**: [useCadStore.ts](file:///C:/Users/3kids/Downloads/3D-Builder/src/store/useCadStore.ts)
*   **R3F Viewport Hit-Testing**: [SketchPreview.tsx](file:///C:/Users/3kids/Downloads/3D-Builder/src/renderer/SketchPreview.tsx)
*   **Constraint Operations UI**: [SketchPropertyManager.tsx](file:///C:/Users/3kids/Downloads/3D-Builder/src/ui/SketchPropertyManager.tsx)
