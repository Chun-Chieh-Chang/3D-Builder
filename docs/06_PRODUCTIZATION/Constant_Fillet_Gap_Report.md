# Feature Gap Audit Report: Constant Fillet Enhancements (Face Selection & Multi-Radius)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Constant Fillet 1 (Video ID: 0jJh2MmVuBc)
**Focus**: Advanced options for "Constant Size Fillet":
- **Face Selection**: Selecting a face automatically fillets all edges of that face.
- **Multi-Radius Fillet**: Assigning different constant radii to different edges/faces within a single fillet feature.
- **Tangent Propagation**: Selection behavior verification.

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: 
    - The Fillet property manager only provides a global `radius` input.
    - It does not allow overriding the radius for individual items in the selection list.
    - There is no "Multiple Radius Fillet" toggle.
- **Backend (`geometry_service.py`)**: 
    - The `FILLET` handler assumes all `refs` are edges and uses the global `r1` / `r2`.
    - It does not check if a reference is a `FACE` type; it only calls `find_matching_edge`.
    - It does not read a per-item `radius` from the `ref` object.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add a "Multiple Radius Fillet" checkbox.
- When checked, each item in the `SelectionBox` list should show an inline numeric input for its specific radius.
- Support adding `FACE` references to the "Items to Fillet" list (currently it's mostly edge-focused in the picker).

### Backend Update (`backend/app/services/geometry_service.py`):
- In the `FILLET` loop:
    - Check the `type` of the reference.
    - **If FACE**: Find matching face, iterate over all its edges, and add them to the `fillet_tool` with the specified radius.
    - **If EDGE**: Use the existing edge logic but prioritize a per-item `radius` if present in the `ref` parameters.

## 4. Priority
- **Status**: Medium-High. Face selection is a major time-saver in CAD workflows. Multi-radius fillets reduce feature tree clutter.
