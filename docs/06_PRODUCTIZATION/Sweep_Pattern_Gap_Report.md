# Feature Gap Audit Report: Advanced Sweep & Pattern (Jump Rope Handle Parity)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Jump Rope Handle (Example 0115-5) (Video ID: cdMRjUgGJT8)
**Focus**: "Jump Rope Handle" (跳繩握柄). Key technical requirements:
- **Revolve main body**: Symmetric/Blind rotation around an axis.
- **Sweep with Guide Curves**: Creating the ergonomic top connection.
- **Circular Pattern**: Creating grip textures or hole patterns around the handle circumference.
- **Advanced Shelling**: Hollow internal structure with uniform wall thickness.

## 2. Analysis of the Gap
- **Sweep (`PartFeaturePropertyManager.tsx`)**: 
    - UI lacks a `SelectionBox` for "Guide Curves". The backend supports them, but the user cannot select them in the interface.
    - Lacks "Thin Sweep" parameters.
- **Pattern (`PartFeaturePropertyManager.tsx`)**: 
    - The `CIRCULAR` pattern type is missing an "Axis of Rotation" selection.
    - Lacks an "Equal Spacing" toggle.
    - Lacks a "Total Angle" input (defaults to spacing-based).
- **Backend (`geometry_service.py`)**: 
    - `REVOLVE` and `SHELL` handlers are duplicated in multiple blocks, increasing maintenance risk.
    - `CIRCULAR` pattern needs to handle world-space axis vectors correctly.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- **Sweep Block**: Add a `SelectionBox` for "Guide Curves" (bound to `params.guide_ids`).
- **Pattern Block**:
    - If `pattern_type === 'CIRCULAR'`, show an "Axis Selection" box (using edge or construction line).
    - Add "Equal Spacing" checkbox.
    - Add "Total Angle" input.

### Backend Update (`backend/app/services/geometry_service.py`):
- **Refactor**: Deduplicate `SHELL` and `REVOLVE` blocks into single robust handlers.
- **Pattern Engine**: Implement Circular Pattern transformation using `gp_Trsf.SetRotation(Ax1, angle)`.

## 4. Priority
- **Status**: High. These features enable the construction of "Jump Rope Handle" and similar ergonomic consumer products.
