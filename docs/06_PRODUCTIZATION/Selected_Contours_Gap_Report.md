# Feature Gap Audit Report: Selected Contours & Multi-Region Extrusion

## 1. Context & Source
**Video**: SolidWorks Tutorial: Understanding Sketch Order during Modeling (Video ID: 4Ef4ZFRA_uA)
**Focus**: "Selected Contours" (所選輪廓) and High Sketch Tolerance. The ability to use a single complex sketch with multiple intersecting/overlapping regions and extruding only specific selected regions.

## 2. Analysis of the Gap
Based on the manual code audit:
- **UI (`src/ui/PartFeaturePropertyManager.tsx`)**: There is no UI rollout or selection box for "Selected Contours". The Extrude command implicitly uses the entire sketch profile.
- **Backend (`geometry_service.py`)**: The `EXTRUDE` logic (`f_type == 'EXTRUDE'`) iterates over `cleaned_loops` and builds wires. It then assumes the first wire is the outer boundary and subsequent wires are inner holes (`make_face = BRepBuilderAPI_MakeFace(wires[0]); make_face.Add(inner_wire)`). This logic instantly fails or produces unintended geometry if the sketch has intersecting lines, multiple disjoint regions, or if the user only wants to extrude half of a split circle. It lacks a region/contour face-building algorithm based on a subset of selected geometry.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add a new `Rollout` called "Selected Contours" (所選輪廓) at the bottom of the Extrude and Revolve property managers.
- Inside, provide a `SelectionBox` component bound to `selectedFeature.parameters.selectedContours`.
- The user can select closed regions from the 3D viewport (which would require the viewport to support region-picking, or at least edge-picking to define a closed loop). For now, selecting a set of `SketchEdges` or `SketchNodes` that form a closed loop should be passed to the backend.

### Backend Update (`backend/app/services/geometry_service.py`):
- Modify the `EXTRUDE` and `REVOLVE` handlers: Read `params.get('selectedContours', [])`.
- If `selectedContours` is empty, use the current default behavior (extrude all).
- If `selectedContours` is populated with lists of edge IDs, filter the `cleaned_loops` to only construct wires from the user-selected edges. This allows the backend to build a specific `TopoDS_Face` representing only the intended region.
- (Advanced Region Finding using `BRepBuilderAPI_MakeFace` or `BOPAlgo_Builder` is required for true SolidWorks parity, but edge-list filtering is the first step).

## 4. Priority
- **Status**: Critical. The inability to reuse a single master layout sketch for multiple features violates standard Top-Down design methodologies in SolidWorks.
