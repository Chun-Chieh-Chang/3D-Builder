# Feature Gap Audit Report: Advanced Fillet Profiles (Conic & G2 Curvature)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Curve Fillet (Video ID: vmD-vVv6zMw)
**Focus**: "Fillet Profile" (圓角輪廓). The ability to choose the cross-sectional shape of a fillet beyond a simple circular arc:
- **Circular** (Implemented - Default)
- **Conic Rho** (Missing)
- **Conic Radius** (Missing)
- **Curvature Continuous (G2)** (Missing)

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: 
    - The Fillet property manager only supports a constant radius.
    - Lacks a "Profile" dropdown to select between Circular, Conic, and Curvature Continuous.
    - Lacks a "Rho" value input for Conic profiles.
- **Backend (`geometry_service.py`)**: 
    - The `FILLET` handler uses `BRepFilletAPI_MakeFillet` but never calls `.SetFilletShape()`.
    - It does not support Rho or Curvature-based blending.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add a "Profile" dropdown in the Fillet Parameters rollout.
- Options: `CIRCULAR`, `CONIC_RHO`, `CONIC_RADIUS`, `CURVATURE_CONTINUOUS`.
- When `CONIC_RHO` is selected, show a `Rho` numeric input (0.0 to 1.0).

### Backend Update (`backend/app/services/geometry_service.py`):
- Read `profileType` and `rho` from parameters.
- **Logic for Profile**: 
    - Import `ChFi3d_FilletShape` from `OCC.Core.ChFi3d`.
    - Call `fillet_tool.SetFilletShape(ChFi3d_Rational)` for Circular.
    - Call `fillet_tool.SetFilletShape(ChFi3d_Quartic)` or equivalent for G2/Conic if supported by the tool version.
    - (Note: OpenCASCADE's `BRepFilletAPI_MakeFillet` has limited high-level control over Rho compared to SolidWorks' Parasolid kernel, but we can set the shape mode).

## 4. Priority
- **Status**: Medium. Crucial for "Class-A" surfacing and professional product design where highlight flow is critical.
