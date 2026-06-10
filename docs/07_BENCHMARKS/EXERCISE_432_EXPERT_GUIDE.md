# SolidWorks Exercise: Extrude, Loft, Dome & Shell (Part 432) - Expert Step-by-Step Guide

**Source**: [YouTube: SOLIDWORKS Tutorial: 3D Modeling with Extrude, Loft, Dome & Shell Features | Part No 432](https://www.youtube.com/watch?v=cGA3q5zlGAw)
**Author**: SolidWorks Expert Subagent
**Target Application**: 3D-Builder (SolidWorks 2000 methodology)

## Workflow Translation

This tutorial combines several intermediate features to build a sleek, hollowed 3D component with smooth transitions.

### Phase 1: Base Geometry (Extruded Boss/Base)
1. **Sketch**: Select the **Top Plane** and sketch the base profile (typically a rectangle or slot shape).
2. **Extrude**: Use **Extruded Boss/Base** with a specified depth (e.g., `Blind`, `15mm`).

### Phase 2: Smooth Transition (Lofted Boss/Base)
1. **Profiles**:
   - The first profile is the top face of the extruded base.
   - Create a reference plane offset from the top face.
   - Sketch the second profile (e.g., a smaller circle or ellipse) on the new plane.
2. **Loft Feature**:
   - Select `Features > Lofted Boss/Base`.
   - Select the two profiles. Ensure the green connectors are aligned to prevent the loft from twisting.
   - Click `✓ OK`.

### Phase 3: The Crown (Dome Feature)
1. **Dome**:
   - The top flat face of the lofted profile needs a rounded cap.
   - Select `Features > Dome`.
   - Select the top face.
   - Set the Distance/Height parameter (e.g., `10mm`).
   - Check or uncheck "Continuous Dome" depending on the desired elliptical/spherical shape.
   - Click `✓ OK`.

### Phase 4: Hollowing out the Part (Shell Feature)
1. **Shell**:
   - Select the bottom face of the base geometry (the face to remove).
   - Go to `Features > Shell`.
   - Enter the wall thickness (e.g., `2mm`).
   - The feature will hollow out the Extrude, Loft, and Dome, leaving a uniform wall thickness.
   - Click `✓ OK`.

### Phase 5: Finishing Touches (Fillet)
1. **Fillet**: Select sharp transitional edges between the base and the loft and apply a fillet for stress relief and aesthetics.

---
**SolidWorks UX/UI Compliance Gap Check**:
- *Extrude / Loft / Shell / Fillet*: Supported in backend (`geometry_service.py`).
- *Dome Feature*: **MISSING**. The system completely lacks the `DOME` feature type, UI buttons, and backend geometric implementation. This is the highest priority gap to fix.
