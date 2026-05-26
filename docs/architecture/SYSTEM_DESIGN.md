# 3D-Builder System Architecture (Electron + PythonOCC)

## 1. System Hierarchy

### Layer 1: Frontend Application (Thin Client - Next.js)
The frontend is strictly for presentation, 2D sketch constraint solving, and 3D rendering.
- **UI Architecture**: Next.js App Router + Sea Salt Blue Glassmorphism Styling.
- **CAD Store**: Zustand handles the local state of the Feature Tree, Sketch Nodes/Edges, and UI mode.
- **2D Sketch Engine**: 
  - Graph-based topology (`SketchNode` / `SketchEdge`).
  - **Position-Based Dynamics (PBD) Constraint Solver**: Runs purely on the frontend (`ConstraintSolver.ts`) to provide zero-latency real-time 2D sketch feedback.
- **3D Renderer**: Receives raw triangle mesh data (Positions, Normals, Indices) and renders it using React Three Fiber (`@react-three/fiber`).

### Layer 2: Electron IPC Bridge
The bridge between the React Web UI and the native OS / geometric kernel.
- **`appAPI` / `fileAPI`**: Exposes secure communication channels through `contextBridge`.
- **Process Management**: Electron spawns and manages the lifecycle of the PythonOCC geometric backend.
- **Communication Protocol**: Passes JSON topological structures (closed loops, profiles, extrusion parameters) between Node.js and the Python backend.

### Layer 3: Geometric Kernel (Heavy Backend - PythonOCC)
The core intelligence for 3D solid operations, running locally via Python.
- **Geometric Kernel (OCCT)**: Direct C++ bindings via PythonOCC. Executes Boolean operations, fillets, sweeps, and extrusions.
- **Mesher**: Tessellates the resulting OCCT `TopoDS_Shape` into renderable WebGL meshes.

### Layer 4: File I/O & Storage
- **Native Parser**: Reads and writes standard formats (STEP, IGES, BREP) via PythonOCC.
- **Project Files**: Saves the proprietary JSON feature tree locally to the disk via Electron `fileAPI`.

## 2. Data Flow (Parametric Rebuild Cycle)

1. **User Action**: Modifies a dimension or applies a constraint in the React UI (e.g. via `SketchPropertyManager`).
2. **Frontend Solving**: The PBD solver resolves 2D constraints and updates the Zustand `sketchNodes`.
3. **IPC Call**: Frontend triggers `appAPI.generate3D()` sending the closed loop profiles and feature parameters to Electron.
4. **Backend Processing**: Electron forwards the payload to the local Python process.
5. **Kernel Math**: PythonOCC rebuilds the 3D solid based on the new 2D profiles and extrusion depths.
6. **Tessellation**: PythonOCC extracts the mesh data.
7. **Response**: Electron pipes the mesh payload back to the React frontend.
8. **Render**: React Three Fiber updates the buffer geometry.

## 3. MECE Documentation Policy
This file serves as the **single source of truth** for the system architecture. Older fragmented documents regarding "FastAPI", "Server Connections", or "Electron IPC rules" have been deprecated and consolidated into this document to prevent contradiction and ensure MECE compliance.
