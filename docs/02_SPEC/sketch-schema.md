# 3D-Builder Sketch Schema Specification

> **Status**: Draft v1.0
> **Owner**: 3D-Builder Productization / Core Architecture
> **Applies to**: \sketchNodes\, \sketchEdges\, and \sketchConstraints\ in \.3dbpart\ files
> **Related Specs**: \docs/spec/part-file-format.md\, \docs/spec/feature-schema.md\
> **Related Plan**: \docs/productization/PRODUCTIZATION_PLAN.md\ Phase 0 / Phase 1

---

## 1. Purpose

This document defines the graph-based sketch schema for 3D-Builder. 

Unlike legacy CAD systems that may store sketches as ordered sequences of points, 3D-Builder uses a persistent graph model. This model enables:
- **Constraint-based solving**: dimensions and geometric relations drive geometry.
- **Topological stability**: edges and nodes have stable IDs for downstream feature references.
- **Interactive PBD preview**: fast, physics-like feedback during dragging.
- **Hybrid solving**: PBD for interactive manipulation and a precise solver for final state.

---

## 2. Sketch Graph Architecture

A sketch consists of three primary collections:
1. **Nodes**: 2D points in the sketch plane coordinate system.
2. **Edges**: Geometric entities (lines, arcs, circles) connecting nodes.
3. **Constraints**: Algebraic or geometric rules applied to nodes and edges.

---

## 3. Sketch Nodes

Nodes represent the fundamental vertices of the sketch.

### 3.1 \SketchNode\ Interface

`	s
interface SketchNode {
  id: string;      // Unique stable identifier
  x: number;      // X coordinate in sketch plane
  y: number;      // Y coordinate in sketch plane
  isFixed?: boolean; // If true, solver cannot move this node
}
`

### 3.2 Coordination System
- Origin \(0, 0)\ is the sketch plane origin.
- Units match the document units (default \mm\).

---

## 4. Sketch Edges

Edges represent the visual and geometric entities formed by nodes.

### 4.1 \SketchEdge\ Interface

`	s
type SketchEdgeType = 'LINE' | 'ARC' | 'CIRCLE' | 'CENTER_LINE';

interface SketchEdge {
  id: string;
  type: SketchEdgeType;
  nodeIds: string[]; // Ordered list of node references
  isConstruction?: boolean; // If true, edge is for reference and doesn't form solid profiles
}
`

### 4.2 Edge Types

| Type | Node Requirements | Description |
|---|---|---|
| \LINE\ | 2 nodes | A straight segment from \
odeIds[0]\ to \
odeIds[1]\. |
| \ARC\ | 3 nodes | \
odeIds[0]\=Start, \
odeIds[1]\=End, \
odeIds[2]\=Center (or Mid-point depending on implementation). |
| \CIRCLE\ | 2 nodes | \
odeIds[0]\=Center, \
odeIds[1]\=Point on circumference. |
| \CENTER_LINE\ | 2 nodes | Construction line used for symmetry or revolution axes. |

---

## 5. Sketch Constraints

Constraints define the mathematical relationships between sketch entities.

### 5.1 \SketchConstraint\ Interface

`	s
type ConstraintType = 
  | 'COINCIDENT' 
  | 'HORIZONTAL' 
  | 'VERTICAL' 
  | 'DISTANCE' 
  | 'EQUAL' 
  | 'CONCENTRIC' 
  | 'TANGENT' 
  | 'ANGLE';

interface SketchConstraint {
  id: string;
  type: ConstraintType;
  nodeIds?: string[]; // Referenced nodes
  edgeIds?: string[]; // Referenced edges
  value?: number;    // Numeric value for dimensions (distance, angle)
}
`

### 5.2 Constraint Definitions

| Type | Target | Parameters | Description |
|---|---|---|---|
| \COINCIDENT\ | 2 Nodes | - | Forces two nodes to share the same coordinates. |
| \HORIZONTAL\ | 2 Nodes / 1 Edge | - | Forces Y coordinates to be equal (or edge to be parallel to X). |
| \VERTICAL\ | 2 Nodes / 1 Edge | - | Forces X coordinates to be equal (or edge to be parallel to Y). |
| \DISTANCE\ | 2 Nodes / 1 Edge | \alue\ | Fixed distance between points or length of edge. |
| \EQUAL\ | 2 Edges | - | Forces two edges to have the same length/radius. |
| \CONCENTRIC\ | 2 Arcs/Circles | - | Forces centers to be coincident. |
| \TANGENT\ | Edge & Edge | - | Smooth transition between entities. |
| \ANGLE\ | 2 Edges | \alue\ | Fixed angle between two linear segments. |

---

## 6. Profile Detection

For features like \EXTRUDE\ and \REVOLVE\, 3D-Builder must detect closed loops (profiles) from the graph.

### 6.1 Rules for Loops
- Only non-construction edges are considered.
- A loop is a cycle in the node-edge graph where every node has a degree of exactly 2.
- Arcs and Circles are treated as single logical segments in the graph traversal.

### 6.2 Inner vs Outer Loops
- The loop with the largest bounding area is typically treated as the **Outer Profile**.
- Loops contained within the outer profile are treated as **Holes** (cutouts).

---

## 7. Constraint Solver Integration

3D-Builder employs a dual-solving strategy.

### 7.1 PBD Preview Solver (Interactive)
- Used during mouse drag.
- Treats constraints as "soft" springs/penalties.
- Provides 60fps fluid feedback.
- Schema must support storing transient PBD parameters if needed for session recovery.

### 7.2 Precise Geometric Solver (Final)
- Triggered on mouse release or numeric input.
- Uses Newton-Raphson or similar iterative methods for exact solutions.
- Reports **Over-defined** or **Under-defined** states.

---

## 8. Sketch Definition States

The UI must reflect the solver's understanding of the sketch:

| State | Color | Description |
|---|---|---|
| **Under-defined** | Blue | Entities have degrees of freedom (can still move). |
| **Fully-defined** | Black | No degrees of freedom left. |
| **Over-defined** | Red | Conflicting constraints detected. |
| **Invalid** | Orange | Impossible geometry (e.g. zero-length arc). |

---

## 9. Validation Rules

A sketch validator should check for:
- Dangling nodes (nodes with no edges).
- Missing node/edge references in constraints.
- Duplicate IDs.
- Construction edges used in solid profiles.
- Coincident nodes that should be merged but have different IDs (solver debt).

---

## 10. Example Sketch Data

\\\json
{
  "sketchNodes": {
    "n1": { "id": "n1", "x": 0, "y": 0, "isFixed": true },
    "n2": { "id": "n2", "x": 50, "y": 0 }
  },
  "sketchEdges": {
    "e1": { "id": "e1", "type": "LINE", "nodeIds": ["n1", "n2"] }
  },
  "sketchConstraints": {
    "c1": { "id": "c1", "type": "HORIZONTAL", "edgeIds": ["e1"] },
    "c2": { "id": "c2", "type": "DISTANCE", "edgeIds": ["e1"], "value": 50 }
  }
}
\\\

---

## 11. Phase Acceptance Checklist

### Phase 0
- [x] \SketchNode\, \SketchEdge\, \SketchConstraint\ interfaces defined in code.
- [x] Basic sketch graph can be saved/loaded in \.3dbpart\.
- [ ] Runtime validator for graph integrity (missing refs).
- [ ] Documentation of profile detection rules.

### Phase 1
- [ ] Smart Dimension support.
- [ ] Visual indication of definition states (Blue/Black/Red).
- [ ] Tangent and Concentric constraint implementation.
