# 3D-Builder Architecture Map (Graphify-Derived)

> 📅 Last Updated: 2026-05-31
> 🛠️ Powered by: [Graphify](https://github.com/safishamsi/graphify)
> 📊 Graph Stats: 1161 nodes, 1476 edges, 173 communities

## 🏗️ High-Level System Topology

The project follows a **Decoupled Client-Server B-Rep Architecture**, where the frontend manages state and user interaction while the backend performs heavy geometric computations using OpenCASCADE.

### 1. The Store Central Hub (Zustand)
- **Node**: `useCadStore`
- **Role**: The single source of truth for the entire application.
- **Key Dependencies**:
    - `renderer/OcctShape.tsx` (Renders the 3D geometry)
    - `renderer/Viewport.tsx` (Camera and Interaction)
    - `ui/PartFeaturePropertyManager.tsx` (Feature parameters)
    - `hooks/usePartRebuild.ts` (State synchronization)

### 2. Geometric Kernel (Python/OCCT)
- **Node**: `backend/app/services/geometry_service.py`
- **Central Function**: `process_features()`
- **Core Operations**:
    - `build_feature_shape_in_isolation()`: Independent geometric construction.
    - `process_features_cached()`: LRU-based geometric caching.
    - `TopologicalLinker`: Manages TNS (Topological Naming Service) for parametric stability.
    - `_shape_to_mesh()`: Converts B-Rep (TopoDS) to displayable Three.js buffers.

### 3. Frontend Reconstruction Pipeline
- **Hook**: `usePartRebuild.ts`
- **Role**: Orchestrates the communication between the local store and the Heavy Engine.
- **Client**: `HeavyEngineClient` (Handles HTTP/IPC with the Python backend).

### 4. Interactive Viewport Community
- **Community 10**: `Home`, `useAppIntegrations`, `useFeatureBuilders`, `DatumPlanes`, `SketchPreview`, `CameraHandler`.
- **Role**: Manages the R3F (React Three Fiber) scene graph and user input mapping.

---

## 🔍 Semantic Search Capabilities
This project is indexed via Graphify, allowing for low-token semantic queries.
To understand complex dependencies, run:
```bash
npm run graphify:query "Describe the data flow from a Sketch modification to a 3D Mesh update"
```

## 📈 Dependency Graph Highlights
- **God Nodes**: `DEV_LOG.md` (Knowledge Hub), `useCadStore` (State Hub), `HeavyEngineClient` (Bridge Hub).
- **Surprising Links**: `OcctShape` -> `useCadStore` (Direct reactive binding for performance), `CameraHandler` -> `useCadStore` (Selection-driven camera focusing).

---
*Note: This map is automatically generated/verified using Graphify's semantic community clustering.*
