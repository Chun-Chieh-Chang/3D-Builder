# Feature Gap Audit Report: Hole Wizard Enhancements (C-Bore, C-Sink, Standards)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Hole Wizard (Video ID: ibjDXLBsAns)
**Focus**: "Hole Wizard" (異形孔精靈). This tool simplifies the creation of standard hole types like Counterbore, Countersink, and Tapped holes by using predefined mechanical standards.

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: 
    - Lacks specialized inputs for advanced hole types. For example, when `COUNTERBORE` is selected, it does not show inputs for "Counterbore Diameter" or "Counterbore Depth".
    - Lacks a "Standards" selection (ANSI, ISO, DIN).
    - Lacks a "Hole Size" dropdown (M3, M4, M5, etc.).
    - Lacks a "Positions" tab or multi-point placement (currently limited to one reference point).
- **Backend (`geometry_service.py`)**: 
    - Has basic support for `COUNTERBORE` and `COUNTERSINK` logic but relies on the UI providing the raw dimensions. 
    - Lacks a "Hole Standard Library" to map standard sizes (like "M5") to physical dimensions (5.5mm hole, 10mm C-Bore, etc.).

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Expand the `HOLE_WIZARD` spec block:
    - **If COUNTERBORE**: Add `cb_diameter` and `cb_depth` inputs.
    - **If COUNTERSINK**: Add `cs_diameter` and `cs_angle` inputs.
- Add a "Standard" select dropdown.
- Add a "Size" select dropdown (M-series).
- Add a helper function to populate dimensions based on Standard + Size.

### Backend Update (`backend/app/services/geometry_service.py`):
- Ensure the `HOLE_WIZARD` loop can iterate over multiple `hole_placement_refs` to support pattern-like placement in a single feature.

## 4. Priority
- **Status**: High. Hole Wizard is the primary way holes are created in professional CAD. Manual creation via revolve/extrude cut is inefficient.
