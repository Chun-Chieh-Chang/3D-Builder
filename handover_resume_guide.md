# 3D-Builder Handoff & Resume Guide

## Current State of Development (2026-05-18)
The project is currently implementing an industrial-grade **SolidWorks-like 3D Web CAD application**. The technology stack includes **Next.js, TailwindCSS, React Three Fiber (R3F), Zustand, and a FastAPI + PythonOCC backend**.

### Recent Major Achievements
1. **O-Snap Smart Sketch Snapping (智慧游標捕捉引擎)**: 
   - Implemented a dynamic `onPointerMove` cursor with `SNAP_RADIUS`.
   - Advanced Object Snapping prioritization: Origin > Sketch EndPoints > 3D Feature Vertices > Grid.
   - Built a high-performance `useMemo` orthographic projection engine that maps all existing 3D vertices from `meshData` onto the active 2D sketching plane, matching SolidWorks' reference geometry snapping perfectly.
2. **History Rollback Bar & X-Ray Sketching (時光退回與 X-Ray 穿透)**:
   - When editing a historical sketch, the system dynamically slices the `features` array before sending it to the backend (`HeavyEngineClient.getInstance().rebuild`), causing all future solids to instantly disappear (SolidWorks Rollback).
   - Applied `depthTest={false}` to all sketch `<Line>` and marker components in `SketchPreview.tsx`, ensuring new sketch geometry perfectly overrides any existing obstructing 3D solids (X-Ray effect).
3. **Double-Click "Flip Normal To" (雙面翻轉正對其)**:
   - "Normal To" camera transition was perfected by locking OrbitControls purely declaratively (`isCameraAnimating`).
   - Implemented `cameraNormalFlip` in `useCadStore`. Clicking "Normal To" on the same plane twice elegantly flips the camera 180 degrees (Front/Back) while adjusting the Up-Vector to preserve the Right-Hand Rule and prevent upside-down sketching.

### Known Issues & Next Steps
- **Advanced Constraints Solver**: While sketch relations like "Horizontal" and "Equal" exist, they lack a true geometric degree-of-freedom (DOF) solver. The next milestone should be integrating an advanced 2D geometric constraint solver.
- **Measurement & Mass Properties**: SolidWorks' "Evaluate" functionality needs physical measurement support via OCCT's `GProp_GProps` to compute actual center of mass, surface area, and volume accurately based on selected topologies.

## How to Resume
1. **Server Boot**: Always start the backend first via `uvicorn app.main:app --host 0.0.0.0 --port 8400` in the `backend` folder.
2. **Frontend Boot**: Run `npm run dev` in the root folder.
3. **Code Quality**: Always run `npx tsc --noEmit` after modifying React components to ensure strict type safety.
4. **Agent Instructions**: Read `DEV_LOG.md` to understand the root causes of past issues (e.g. Gimbal Lock avoidance, React Reconciliation conflicts). Never guess; always apply standard CAPA diagnostics.
