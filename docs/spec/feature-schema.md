# 3D-Builder Feature Schema Specification

> **Status**: Draft v1.0  
> **Owner**: 3D-Builder Productization / Core Architecture  
> **Applies to**: `features[]` records inside `.3dbpart` files  
> **Related Specs**: `docs/spec/part-file-format.md`, `docs/spec/sketch-schema.md`  
> **Related Plan**: `docs/productization/PRODUCTIZATION_PLAN.md` Phase 0 / Phase 1

---

## 1. Purpose

This document defines the feature tree schema used by native 3D-Builder `.3dbpart` files.

The feature tree is the ordered parametric rebuild history of a part. Each feature record must be stable enough to survive save/load cycles, support rollback/edit operations, and be sent to the geometry backend for rebuild.

---

## 2. Design Goals

1. **Parametric rebuild**: preserve enough parameters to regenerate B-Rep geometry.
2. **Editability**: allow feature parameters and source sketches to be edited later.
3. **Rollback support**: keep feature order deterministic.
4. **Forward compatibility**: unknown optional fields should be preserved where possible.
5. **Product honesty**: features must describe 3D-Builder native behavior, not imply SolidWorks-native feature compatibility.

---

## 3. Feature Tree Semantics

`features` is an ordered array in `.3dbpart`.

```json
{
  "features": [
    {
      "id": "feat_001",
      "type": "EXTRUDE",
      "name": "Custom Extrude 1",
      "parameters": {}
    }
  ]
}
```

Rules:

- Array order is rebuild order.
- Earlier features may be parents of later features.
- Rollback index refers to this array order.
- Suppressed features are skipped during rebuild but retained in file.
- Unknown feature types should not crash file open; they should be marked unsupported/suppressed until a migration is available.

---

## 4. Base Feature Interface

```ts
interface PartFeature {
  id: string;
  type: FeatureType;
  name: string;
  parameters: FeatureParameters;
  suppressed?: boolean;
  parentIds?: string[];
  childIds?: string[];
  version?: number;
  metadata?: FeatureMetadata;
}

interface FeatureMetadata {
  createdAt?: string;
  updatedAt?: string;
  author?: string;
  notes?: string;
}
```

### 4.1 Required Fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | Yes | Stable unique feature identifier. |
| `type` | string | Yes | Feature type enum. |
| `name` | string | Yes | User-visible feature name. |
| `parameters` | object | Yes | Feature-specific parameter dictionary. |

### 4.2 Optional Fields

| Field | Type | Description |
|---|---|---|
| `suppressed` | boolean | If true, feature is skipped in rebuild. |
| `parentIds` | string[] | Explicit parent dependency references. |
| `childIds` | string[] | Optional cached child dependency references. |
| `version` | number | Feature schema version for this feature type. |
| `metadata` | object | Future feature-level metadata. |

---

## 5. Feature Type Enum

Initial supported feature types:

```ts
type FeatureType =
  | 'SKETCH_RECT'
  | 'EXTRUDE'
  | 'BOX'
  | 'CYLINDER'
  | 'SPHERE'
  | 'REVOLVE'
  | 'FILLET'
  | 'CHAMFER'
  | 'PATTERN'
  | 'REFERENCE_PLANE'
  | 'REFERENCE_AXIS';
```

Feature types are grouped as:

| Group | Types |
|---|---|
| Primitive solids | `BOX`, `CYLINDER`, `SPHERE` |
| Sketch-based solids | `EXTRUDE`, `REVOLVE` |
| Detail features | `FILLET`, `CHAMFER` |
| Transform/replication | `PATTERN` |
| Reference geometry | `REFERENCE_PLANE`, `REFERENCE_AXIS` |
| Legacy/compatibility | `SKETCH_RECT` |

---

## 6. Common Parameter Conventions

### 6.1 Numeric Units

All numeric length parameters are in document units. Phase 0/1 default unit is `mm`.

Examples:

- `width`
- `height`
- `depth`
- `radius`
- `distance`
- `spacing`
- `x`, `y`, `z`

Angles are in degrees unless explicitly stated otherwise.

### 6.2 Operation Enum

Sketch-based or generated solid features may include:

```ts
type BooleanOperation = 'ADD' | 'CUT';
```

Meaning:

| Operation | Backend behavior |
|---|---|
| `ADD` | Fuse feature shape into current body. |
| `CUT` | Cut feature shape from current body. |

### 6.3 Plane Enum

```ts
type SketchPlane = 'FRONT' | 'TOP' | 'RIGHT' | 'FACE';
```

| Plane | Meaning |
|---|---|
| `FRONT` | XY plane; normal +Z. |
| `TOP` | XZ plane; normal +Y. |
| `RIGHT` | YZ plane; normal +X. |
| `FACE` | Local coordinate system derived from selected planar face. |

### 6.4 Local Coordinates

`x`, `y`, `z` represent global origin offsets for simple primitives or base plane origins.

For `FACE` sketches, `faceOrigin` and `faceNormal` define the selected face reference. Future versions should replace this with a persistent `TopologyReference`.

---

## 7. Primitive Solid Features

### 7.1 `BOX`

```ts
interface BoxFeature extends PartFeature {
  type: 'BOX';
  parameters: {
    width: number;
    height: number;
    depth: number;
    x?: number;
    y?: number;
    z?: number;
    operation?: BooleanOperation;
  };
}
```

Default values:

| Parameter | Default |
|---|---:|
| `width` | `10` |
| `height` | `10` |
| `depth` | `10` |
| `x` | `0` |
| `y` | `0` |
| `z` | `0` |
| `operation` | `ADD` |

Validation:

- `width`, `height`, `depth` must be positive.
- `operation` defaults to `ADD` if omitted.

### 7.2 `CYLINDER`

```ts
interface CylinderFeature extends PartFeature {
  type: 'CYLINDER';
  parameters: {
    radius: number;
    height: number;
    x?: number;
    y?: number;
    z?: number;
    operation?: BooleanOperation;
  };
}
```

Validation:

- `radius > 0`.
- `height > 0`.

### 7.3 `SPHERE`

```ts
interface SphereFeature extends PartFeature {
  type: 'SPHERE';
  parameters: {
    radius: number;
    x?: number;
    y?: number;
    z?: number;
    operation?: BooleanOperation;
  };
}
```

Validation:

- `radius > 0`.

---

## 8. Sketch-based Features

### 8.1 Sketch Profile Representation

During schema `1.0.0`, sketch profiles may be stored in two forms:

1. **Legacy/generation profile**: `points` array used by the PythonOCC backend.
2. **Editable graph snapshot**: `sketchNodes`, `sketchEdges`, `sketchConstraints` inside `parameters`.

Example:

```json
{
  "points": [
    [[0, 0, "START"], [40, 0], [40, 20], [0, 20], [0, 0]]
  ],
  "sketchNodes": {},
  "sketchEdges": {},
  "sketchConstraints": {}
}
```

Rules:

- `points` may be a single loop or nested loops.
- First loop is treated as outer profile.
- Additional loops are treated as holes/cutouts where supported.
- `sketchNodes/sketchEdges/sketchConstraints` preserve editability and should not be discarded.

### 8.2 `EXTRUDE`

```ts
interface ExtrudeFeature extends PartFeature {
  type: 'EXTRUDE';
  parameters: {
    points: SketchProfileLoops;
    depth: number;
    operation: BooleanOperation;
    plane: SketchPlane;
    x?: number;
    y?: number;
    z?: number;
    relations?: string[];
    sketchNodes?: Record<string, SketchNode>;
    sketchEdges?: Record<string, SketchEdge>;
    sketchConstraints?: Record<string, SketchConstraint>;
    faceOrigin?: [number, number, number] | null;
    faceNormal?: [number, number, number] | null;
    faceId?: string | null;
  };
}
```

Validation:

- `depth` must be non-zero. Positive depth follows active plane normal.
- `operation` must be `ADD` or `CUT`.
- `plane` must be `FRONT`, `TOP`, `RIGHT`, or `FACE`.
- If `plane === 'FACE'`, `faceOrigin` and `faceNormal` should be present.
- `points` must contain at least one closed profile loop with at least three non-collinear points.

### 8.3 `REVOLVE`

```ts
interface RevolveFeature extends PartFeature {
  type: 'REVOLVE';
  parameters: {
    points: SketchProfileLoops;
    angle: number;
    operation?: BooleanOperation;
    plane: SketchPlane;
    x?: number;
    y?: number;
    z?: number;
    sketchNodes?: Record<string, SketchNode>;
    sketchEdges?: Record<string, SketchEdge>;
    sketchConstraints?: Record<string, SketchConstraint>;
    faceOrigin?: [number, number, number] | null;
    faceNormal?: [number, number, number] | null;
    faceId?: string | null;
  };
}
```

Validation:

- `angle` must be greater than `0` and less than or equal to `360`.
- `points` must form a valid closed profile.
- Current backend revolves around the local Y-axis. Future schema should expose `axisReference` explicitly.

---

## 9. Detail Features

### 9.1 `FILLET`

```ts
interface FilletFeature extends PartFeature {
  type: 'FILLET';
  parameters: {
    radius: number;
    edge_start?: [number, number, number];
    edge_end?: [number, number, number];
    topologyRef?: TopologyReference;
  };
}
```

Validation:

- `radius > 0`.
- At least one edge selection mechanism should be present.
- Current backend supports coordinate-matched `edge_start` / `edge_end`.
- Future backend should prefer `topologyRef`.

### 9.2 `CHAMFER`

```ts
interface ChamferFeature extends PartFeature {
  type: 'CHAMFER';
  parameters: {
    distance: number;
    edge_start?: [number, number, number];
    edge_end?: [number, number, number];
    topologyRef?: TopologyReference;
  };
}
```

Validation:

- `distance > 0`.
- Edge reference rules match `FILLET`.

---

## 10. Pattern Feature

### 10.1 `PATTERN`

```ts
interface PatternFeature extends PartFeature {
  type: 'PATTERN';
  parameters: {
    target_feature_id: string;
    pattern_type: 'LINEAR' | 'CIRCULAR';
    axis: 'X' | 'Y' | 'Z';
    count: number;
    spacing: number;
  };
}
```

Meaning:

| Parameter | Meaning |
|---|---|
| `target_feature_id` | Feature to duplicate. |
| `pattern_type` | Linear translation or circular rotation. |
| `axis` | Axis used for translation/rotation. |
| `count` | Total number of instances including original, where backend may generate copies from index 1. |
| `spacing` | Linear distance for `LINEAR`, angle in degrees for `CIRCULAR`. |

Validation:

- `target_feature_id` must refer to an earlier non-pattern feature.
- `count >= 1`.
- `axis` must be `X`, `Y`, or `Z`.
- `pattern_type` must be `LINEAR` or `CIRCULAR`.

---

## 11. Reference Geometry Features

### 11.1 `REFERENCE_PLANE`

```ts
interface ReferencePlaneFeature extends PartFeature {
  type: 'REFERENCE_PLANE';
  parameters: {
    planeType: string;
    refs: TopologyReference[];
    offset?: number;
    origin?: [number, number, number];
    normal?: [number, number, number];
    xDir?: [number, number, number];
    yDir?: [number, number, number];
  };
}
```

Initial supported `planeType` values are implementation-defined and should be documented as the UI stabilizes. Current backend recognizes offset/topology-derived reference planes.

### 11.2 `REFERENCE_AXIS`

```ts
interface ReferenceAxisFeature extends PartFeature {
  type: 'REFERENCE_AXIS';
  parameters: {
    axisType: string;
    refs: TopologyReference[];
    origin?: [number, number, number];
    direction?: [number, number, number];
  };
}
```

---

## 12. Topology Reference Placeholder

Feature schema `1.0.0` allows a transitional topology reference shape:

```ts
interface TopologyReference {
  featureId?: string;
  topologyType: 'FACE' | 'EDGE' | 'VERTEX';
  id?: string;
  coordinates?: [number, number, number];
  normal?: [number, number, number];
  geometricSignature?: {
    center?: [number, number, number];
    normal?: [number, number, number];
    area?: number;
    length?: number;
    curvatureType?: 'PLANE' | 'CYLINDER' | 'SPHERE' | 'CONE' | 'UNKNOWN';
  };
}
```

Phase 0/1 may still use coordinate matching for fillet/chamfer and face sketches. Phase 2 should introduce a dedicated topological naming service.

---

## 13. Legacy Feature Compatibility

### 13.1 `SKETCH_RECT`

`SKETCH_RECT` is considered a legacy compatibility feature.

Readers may preserve it and migrate to `EXTRUDE` with sketch data where possible.

### 13.2 Flexible Parameters

Current alpha files may contain additional parameters not listed in this spec. Readers should preserve unknown parameters when saving, unless they are known to be unsafe.

---

## 14. Rebuild Rules

The geometry backend should process features as follows:

1. Initialize `finalShape = null`.
2. Iterate `features` in order.
3. Skip `suppressed === true`.
4. Build the feature shape in isolation where applicable.
5. Apply boolean operation (`ADD` or `CUT`) to `finalShape`.
6. Apply detail features (`FILLET`, `CHAMFER`) to current `finalShape`.
7. Apply patterns by duplicating a target feature or target shape.
8. Return final mesh and/or B-Rep export shape.

Failure behavior:

- If a feature fails, backend should return feature-specific error context.
- UI should mark the failed feature in the feature tree.
- Rebuild should not silently ignore critical failures in product builds.

---

## 15. Validation Rules

A feature validator should check:

- Unique `id` values.
- Known `type` values.
- `parameters` object exists.
- Positive lengths/radii where required.
- Valid boolean operations.
- Valid plane enum values.
- Pattern target references an existing earlier feature.
- Sketch profile loops are closed before extrusion/revolve.
- Topology references are either valid or reported as broken.

Recommended severity:

| Problem | Severity |
|---|---|
| Unknown optional parameter | Preserve + ignore |
| Missing required feature field | Error |
| Unknown feature type | Warning + suppress |
| Invalid numeric parameter | Error |
| Broken parent/topology reference | Warning on open, error on rebuild if required |
| Feature rebuild failure | Error with feature ID/name |

---

## 16. Example Features

### 16.1 Box

```json
{
  "id": "feat_box_001",
  "type": "BOX",
  "name": "方塊特徵 1",
  "parameters": {
    "width": 40,
    "height": 20,
    "depth": 10,
    "x": 0,
    "y": 0,
    "z": 0,
    "operation": "ADD"
  }
}
```

### 16.2 Extrude Cut

```json
{
  "id": "feat_cut_001",
  "type": "EXTRUDE",
  "name": "伸長-除料 2",
  "parameters": {
    "points": [[[0, 0, "START"], [10, 0], [10, 10], [0, 10], [0, 0]]],
    "depth": 5,
    "operation": "CUT",
    "plane": "FRONT",
    "sketchNodes": {},
    "sketchEdges": {},
    "sketchConstraints": {}
  }
}
```

### 16.3 Circular Pattern

```json
{
  "id": "feat_pattern_001",
  "type": "PATTERN",
  "name": "特徵陣列 3",
  "parameters": {
    "target_feature_id": "feat_cut_001",
    "pattern_type": "CIRCULAR",
    "axis": "Z",
    "count": 4,
    "spacing": 90
  }
}
```

---

## 17. Phase Acceptance Checklist

### Phase 0

- [x] Existing feature records can be written into `.3dbpart`.
- [x] Feature schema is documented.
- [ ] Runtime validator exists for base feature shape.
- [ ] Runtime validator checks feature ID uniqueness.
- [ ] Runtime validator checks pattern target references.

### Phase 1

- [ ] Feature-specific validators exist for `EXTRUDE`, `REVOLVE`, `FILLET`, `CHAMFER`, and `PATTERN`.
- [ ] Feature rebuild errors return feature ID/name and user-actionable message.
- [ ] Edit Feature and Edit Sketch flows preserve schema fields.

### Phase 2

- [ ] Topology references use a stable topological naming service.
- [ ] Broken references are visible in the FeatureManager UI.
- [ ] Suppress/unsuppress and reorder operations preserve parent/child validity.

---

## 18. Follow-up Work

1. Implement `src/kernel` or `src/utils` runtime validators for base feature shape.
2. Add feature schema validation to file open path.
3. Add golden `.3dbpart` fixtures for Box, Extrude, Cut, Fillet, Revolve, and Pattern.
4. Define `docs/spec/sketch-schema.md` for graph-level sketch persistence.
5. Define `docs/spec/geometry-api.md` for backend request/response contracts.
