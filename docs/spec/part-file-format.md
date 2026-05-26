# 3D-Builder Part File Format Specification (`.3dbpart`)

> **Status**: Draft v1.0  
> **Owner**: 3D-Builder Productization / Core Architecture  
> **Applies to**: native 3D-Builder parametric part files  
> **Related Plan**: `docs/productization/PRODUCTIZATION_PLAN.md` Phase 0 P0/P1

---

## 1. Purpose

`.3dbpart` is the native parametric part file format for 3D-Builder.

It stores the editable 3D-Builder feature tree, sketch graph data, constraints, metadata, units, and future product-level information as versioned JSON.

This format is **not** a SolidWorks `.sldprt` file and must never be described as SolidWorks-native compatible.

---

## 2. Format Identity

| Field | Value |
|---|---|
| File extension | `.3dbpart` |
| MIME-like identity | `application/vnd.3dbuilder.part+json` |
| Root schema | `com.3dbuilder.part` |
| Current schema version | `1.0.0` |
| Encoding | UTF-8 JSON |
| Geometry unit default | `mm` |

---

## 3. Non-goals

The `.3dbpart` format does **not** attempt to:

- Store or emulate SolidWorks native `.sldprt` binary data.
- Store Parasolid-native feature history.
- Guarantee that imported STEP/IGES dumb solids can be converted back into parametric features.
- Replace standard CAD exchange formats such as STEP, IGES, or STL.

Standard exchange remains separate:

| Use case | Format |
|---|---|
| Editable 3D-Builder native project | `.3dbpart` |
| B-Rep exchange with other CAD tools | `.step`, `.stp` |
| Surface/legacy CAD exchange | `.iges`, `.igs` |
| Mesh/3D printing | `.stl` |
| SolidWorks native input | Unsupported directly; user should export STEP/IGES from SolidWorks |

---

## 4. Canonical JSON Shape

A valid `.3dbpart` file must use this root shape:

```json
{
  "schema": "com.3dbuilder.part",
  "schemaVersion": "1.0.0",
  "appVersion": "3.1.0-alpha",
  "units": "mm",
  "metadata": {
    "projectName": "New Project",
    "createdAt": "2026-05-24T00:00:00.000Z",
    "updatedAt": "2026-05-24T00:00:00.000Z",
    "author": "",
    "description": ""
  },
  "features": [],
  "sketchNodes": {},
  "sketchEdges": {},
  "sketchConstraints": {},
  "materials": {},
  "documentSettings": {
    "drawingScale": "1:1",
    "precision": 3
  }
}
```

Current application code may omit `metadata`, `materials`, and `documentSettings` during the transition from legacy schema. Consumers must treat these fields as optional until the writer is upgraded to emit the full canonical shape.

---

## 5. Required Root Fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `schema` | string | Yes | Must be `com.3dbuilder.part`. |
| `schemaVersion` | string | Yes | Semantic version of file schema. Current: `1.0.0`. |
| `appVersion` | string | Yes | 3D-Builder app version that wrote the file. |
| `units` | string | Yes | Unit system. Initial supported value: `mm`. |
| `features` | array | Yes | Ordered parametric feature tree. |
| `sketchNodes` | object | Yes | Graph nodes for active/global sketch data. |
| `sketchEdges` | object | Yes | Graph edges for active/global sketch data. |
| `sketchConstraints` | object | Yes | Constraint records for sketch solving. |

---

## 6. Optional Root Fields

| Field | Type | Description |
|---|---|---|
| `metadata` | object | Human/project metadata. |
| `materials` | object | Future material library and assignments. |
| `documentSettings` | object | Precision, drawing defaults, display settings. |
| `externalReferences` | array | Future references to imported STEP/STL/IGES files. |
| `migrationHistory` | array | Future schema migration trace. |

Readers must ignore unknown root fields for forward compatibility.

---

## 7. Feature Tree Format

`features` is an ordered array. The order is the rebuild order.

Minimum feature shape:

```ts
interface PartFeature {
  id: string;
  type: FeatureType;
  name: string;
  parameters: Record<string, unknown>;
  suppressed?: boolean;
  parentIds?: string[];
  childIds?: string[];
  version?: number;
}
```

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

### 7.1 Feature IDs

- Must be unique within the file.
- Should be stable across save/load cycles.
- Recommended format: `feat_<timestamp-or-uuid>`.

### 7.2 Feature Parameters

Feature `parameters` are feature-type specific. During Phase 0/1, the file format permits flexible parameter dictionaries to preserve existing project behavior.

Future specs should split each feature type into a dedicated schema in `docs/spec/feature-schema.md`.

---

## 8. Sketch Graph Format

The global sketch graph is currently stored in three root maps.

### 8.1 `sketchNodes`

```ts
interface SketchNode {
  id: string;
  x: number;
  y: number;
  isFixed?: boolean;
}
```

Map shape:

```json
{
  "node-id": {
    "id": "node-id",
    "x": 0,
    "y": 0,
    "isFixed": true
  }
}
```

### 8.2 `sketchEdges`

```ts
type SketchEdgeType = 'LINE' | 'ARC' | 'CIRCLE' | 'CENTER_LINE';

interface SketchEdge {
  id: string;
  type: SketchEdgeType;
  nodeIds: string[];
  isConstruction?: boolean;
}
```

### 8.3 `sketchConstraints`

```ts
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
  nodeIds?: string[];
  edgeIds?: string[];
  value?: number;
}
```

---

## 9. Embedded Feature Sketch Data

Features that originate from sketches, especially `EXTRUDE` and `REVOLVE`, may also embed snapshot sketch graph data inside `feature.parameters`:

```json
{
  "id": "feat_001",
  "type": "EXTRUDE",
  "name": "Custom Extrude 1",
  "parameters": {
    "points": [],
    "sketchNodes": {},
    "sketchEdges": {},
    "sketchConstraints": {},
    "depth": 10,
    "operation": "ADD",
    "plane": "FRONT"
  }
}
```

This is allowed in schema `1.0.0` for backward compatibility with the current feature edit workflow.

Future schema versions should consider normalizing sketches into a top-level `sketches` map and referencing them by ID from features.

---

## 10. Backward Compatibility

The loader must support legacy internal JSON files with:

```json
{
  "schema": "3D-BUILDER-PARAMETRIC-SCHEMA"
}
```

Migration rules:

| Legacy field | New field |
|---|---|
| `schema: "3D-BUILDER-PARAMETRIC-SCHEMA"` | `schema: "com.3dbuilder.part"` |
| `version` | `appVersion` |
| missing `schemaVersion` | default to `1.0.0` during migration |
| missing `units` | default to `mm` |

When a legacy file is opened and then saved, the writer must emit the new `.3dbpart` schema.

---

## 11. Validation Rules

A `.3dbpart` reader should reject or warn when:

- `schema` is not `com.3dbuilder.part` and not a known legacy schema.
- `features` is missing or not an array.
- `sketchNodes`, `sketchEdges`, or `sketchConstraints` are missing or not objects.
- Feature IDs are duplicated.
- Sketch edge `nodeIds` refer to missing nodes.
- Sketch constraints refer to missing nodes or edges.
- `units` is not supported.

Recommended validation severity:

| Problem | Severity |
|---|---|
| Unknown future root field | Ignore |
| Unknown feature parameter | Preserve and ignore if not used |
| Unknown feature type | Warning + suppress feature |
| Missing required root field | Error |
| Broken sketch graph references | Error for rebuild, warning for file open |
| Unsupported schema major version | Error |

---

## 12. Versioning Policy

`schemaVersion` uses semantic versioning.

| Change type | Version impact |
|---|---|
| Add optional field | Minor |
| Add new feature type with backward-safe ignore behavior | Minor |
| Change required root field | Major |
| Remove legacy compatibility | Major |
| Clarify documentation only | Patch |

Reader behavior:

- Same major version: attempt to read.
- Higher minor version: read known fields, preserve unknown fields when possible.
- Higher major version: refuse by default and show compatibility warning.

---

## 13. Security and Robustness

Readers must treat `.3dbpart` as untrusted input.

Required safeguards:

- Do not execute code from file fields.
- Limit maximum JSON file size before parsing.
- Validate arrays and object maps before passing to geometry kernel.
- Defend against deeply nested objects.
- Never allow file paths inside `.3dbpart` to trigger arbitrary writes without user confirmation.

---

## 14. Save/Open UX Requirements

### 14.1 Save

Native save must:

- Default to `part.3dbpart`.
- Use the file filter `3D-Builder Part Files (*.3dbpart)`.
- Display success wording as `3D-Builder 參數化零件已保存至 ...`.
- Never label the result as SolidWorks native `.sldprt`.

### 14.2 Open

Open dialog should include:

- `3D-Builder Part Files (*.3dbpart)`.
- Standard exchange files: `*.step`, `*.stp`, `*.iges`, `*.igs`, `*.stl`.
- SolidWorks native files may appear only with wording similar to: `unsupported; convert to STEP first`.

### 14.3 SolidWorks Native Files

If a user opens `.sldprt` or `.sldasm`, the app must not try to parse it as `.3dbpart`. It should show a guidance dialog explaining that the user should export STEP/IGES from SolidWorks.

---

## 15. Example Minimal File

```json
{
  "schema": "com.3dbuilder.part",
  "schemaVersion": "1.0.0",
  "appVersion": "3.1.0-alpha",
  "units": "mm",
  "features": [],
  "sketchNodes": {},
  "sketchEdges": {},
  "sketchConstraints": {}
}
```

---

## 16. Phase 0 Acceptance Checklist

- [x] Native file extension is `.3dbpart`.
- [x] Native schema is `com.3dbuilder.part`.
- [x] Save flow does not label native files as `.sldprt`.
- [x] Package file association uses `3dbpart`.
- [x] SolidWorks native files are marked unsupported and routed to converter guidance.
- [ ] Runtime writer emits canonical optional fields (`metadata`, `documentSettings`) where available.
- [ ] Loader validates feature IDs and sketch graph references.
- [ ] Dedicated `feature-schema.md` exists.
- [ ] Dedicated `sketch-schema.md` exists.

---

## 17. Next Specs

This file establishes the root container. Follow-up specs should define:

1. `docs/spec/feature-schema.md`
2. `docs/spec/sketch-schema.md`
3. `docs/spec/geometry-api.md`
4. `docs/spec/release-gates.md`
