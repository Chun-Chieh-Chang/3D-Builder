# Viewport Rendering & Snapping Engine

The 3D canvas represents the visual workspace of 3D-Builder, integrating React Three Fiber (R3F), GSAP camera animations, and the O-Snap smart snapping engine.

---

## 1. Viewport components & R3F setup
Located in `src/renderer/Viewport.tsx`, the viewport wraps:
- **OrbitControls**: Mouse tracking for rotating, panning, and zooming the 3D stage.
- **CameraHandler**: Commands command-based GSAP transitions to smoothly align the camera "Normal To" any selected plane or face.
- **DatumPlanes**: Standard base coordinate grids (FRONT, TOP, RIGHT) and custom reference planes (violet-blue `#6366f1` translucent surfaces).
- **OcctShape**: The parsed 3D solid meshes returned by the OpenCASCADE server.

---

## 2. Hit-testing for Graph Entities
In `src/renderer/SketchPreview.tsx`, R3F maps the graph-based data:
- **Node markers**: Drawn as small spheres or circles at 2D coordinate positions.
- **Edges**: Drawn as lines or arcs. To make mouse clicks highly responsive, each edge is rendered as a dual-layer element:
  1. An inner visible thin line (colored blue or gray).
  2. An outer invisible thick hit-receiver (`strokeWidth={15}`, opacity = 0).
- This solves the classic 3D-picking issue, ensuring 100% accurate click capturing even when selecting lines only 1 pixel wide.

---

## 3. O-Snap (Smart Snapping) Engine
To enable professional, precise CAD drawing, `src/renderer/DatumPlanes.tsx` runs a pointer-move listener that intercepts the raycast coordinates and applies snapping logic:

### Snapping Priority List
1.  **Origin Snap**: Magnets to $(0,0)$ when the mouse cursor falls within a threshold.
2.  **Sketch Node Snap**: Scans existing `sketchNodes` in Zustand and snaps to their coordinates.
3.  **3D Feature Vertex Snap**: Project all 3D solid vertices onto the active plane using orthographic projection, and snaps to them.
4.  **Grid Snap**: Snaps to the nearest grid interval if no geometric feature is captured.

---

## 4. Normal-to Camera Realignment
- **Declarative Animation Lock**: While camera GSAP animations are running, `isCameraAnimating` is set to `true`, disabling OrbitControls to avoid conflict and state jumps.
- **Flip Feature**: Double clicking "Normal To" on the same plane toggles `cameraNormalFlip: boolean` in the state model, allowing developers to view the part from the back side while automatically adjusting the `Z` axis orientation to maintain the right-hand rule.
