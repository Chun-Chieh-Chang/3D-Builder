# SOP: Foundational Block with Center Hole (6-Step Method)

## Purpose
To validate the 3D-Builder CAD pipeline using the 6 basic steps of 3D modeling as defined in industry standards.

## Sequence

### Feature 1: Base Plate
1. **Select Plane**: Top Plane
2. **Start Sketch**: New Sketch
3. **Draw Geometry**: Center Rectangle
4. **Tie to Origin**: Rectangle Center -> Origin (0,0)
5. **Add Dimensions**: 100mm x 100mm
6. **Create Feature**: Extrude Boss/Base, 20mm

### Feature 2: Center Hole
1. **Select Plane**: Top Face of Base Plate
2. **Start Sketch**: New Sketch
3. **Draw Geometry**: Circle
4. **Tie to Origin**: Circle Center -> Origin (0,0)
5. **Add Dimensions**: 50mm Diameter
6. **Create Feature**: Extrude Cut, Through All

## Success Criteria
- Sketch 1 & 2 are Fully Defined.
- Origin is the center point of all geometry.
- Resulting solid has a 50mm passthrough hole.
