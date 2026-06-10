# 3D-Builder Geometry API Specification

> **Status**: Draft v1.0
> **Owner**: 3D-Builder Core Architecture / Geometry Kernel
> **Applies to**: REST API communication between Frontend (Next.js) and Backend (Python/OCC)
> **Base URL**: \http://localhost:8400/api/v1/geometry\
> **Related Specs**: \docs/spec/feature-schema.md\, \docs/spec/sketch-schema.md\
> **Related Plan**: \docs/productization/PRODUCTIZATION_PLAN.md\ Phase 0

---

## 1. Purpose

This document defines the contract for the geometry services. The backend provides B-Rep modeling, mesh tessellation, 2D projection, and CAD file exchange (STEP/IGES/STL) powered by OpenCASCADE.

---

## 2. Common Models

### 2.1 \FeatureDefinition\
Shared model representing a parametric feature.

\\\json
{
  "id": "string",
  "type": "string", // BOX, CYLINDER, SPHERE, EXTRUDE, REVOLVE, FILLET, CHAMFER, PATTERN, REFERENCE_PLANE, REFERENCE_AXIS
  "parameters": "object"
}
\\\

### 2.2 \MeshData\
Standard triangle mesh format for the WebGL renderer.

\\\json
{
  "id": "string",
  "data": {
    "vertices": "number[]", // Flattened [x, y, z, ...]
    "indices": "number[]",  // Triangle indices [0, 1, 2, ...]
    "normals": "number[]"   // Vertex normals [nx, ny, nz, ...]
  }
}
\\\

---

## 3. Endpoints

### 3.1 \POST /rebuild\
Rebuilds the entire feature tree into a single B-Rep solid and returns the tessellated mesh.

- **Request Body**:
  \\\json
  {
    "features": "FeatureDefinition[]"
  }
  \\\
- **Response**: \MeshData[]\ (typically a single item representing the whole part).

---

### 3.2 \POST /mass_properties\
Calculates physical properties of the part.

- **Request Body**:
  \\\json
  {
    "features": "FeatureDefinition[]"
  }
  \\\
- **Response**:
  \\\json
  {
    "volume": "number", // mm³
    "surface_area": "number", // mm²
    "center_of_mass": "number[3]", // [x, y, z]
    "inertia_matrix": "number[3][3]"
  }
  \\\

---

### 3.3 \POST /export\
Exports the current part to a file on the local filesystem.

- **Request Body**:
  \\\json
  {
    "features": "FeatureDefinition[]",
    "format": "string", // 'STEP', 'IGES', 'STL'
    "filepath": "string"
  }
  \\\
- **Response**:
  \\\json
  {
    "status": "SUCCESS",
    "filepath": "string",
    "message": "string"
  }
  \\\

---

### 3.4 \POST /project\
Generates a 2D projection of the 3D model onto a standard plane.

- **Request Body**:
  \\\json
  {
    "features": "FeatureDefinition[]",
    "plane": "string" // 'FRONT', 'TOP', 'RIGHT'
  }
  \\\
- **Response**: \ny[]\ (Collection of 2D entities).

---

### 3.5 \POST /convert_entities\
Projects 3D entities (edges/faces) into a 2D sketch plane.

- **Request Body**:
  \\\json
  {
    "features": "FeatureDefinition[]",
    "selectedTopology": {
      "type": "string", // 'FACE', 'EDGE', 'VERTEX'
      "id": "string",
      "coordinates": "number[]",
      "normal": "number[] | null"
    },
    "activePlane": "string",
    "activeFaceOrigin": "number[] | null",
    "activeFaceNormal": "number[] | null"
  }
  \\\
- **Response**: \ny[]\ (Projected 2D sketch nodes and edges).

---

### 3.6 \POST /intersection_curve\
Slices the 3D solid with the active sketch plane.

- **Request Body**:
  \\\json
  {
    "features": "FeatureDefinition[]",
    "activePlane": "string",
    "activeFaceOrigin": "number[] | null",
    "activeFaceNormal": "number[] | null"
  }
  \\\
- **Response**: \ny[]\ (Intersection edges).

---

### 3.7 \POST /ref_plane\ & \POST /ref_axis\
Generates reference geometry parameters.

- **Request Body**:
  \\\json
  {
    "planeType/axisType": "string",
    "refs": "object[]",
    "offset": "number",
    "features": "FeatureDefinition[]"
  }
  \\\
- **Response**: \object\ (Generated reference geometry definition).

---

## 4. Error Handling

- **500 Internal Server Error**: Geometry kernel failure. The response \detail\ field contains the Python exception trace.
- **422 Unprocessable Entity**: Invalid feature parameters or missing required fields.

---

## 5. Security & Robustness

- The API is strictly local-only (\localhost\).
- Large feature lists should be streamed or limited to prevent memory exhaustion in the kernel.
