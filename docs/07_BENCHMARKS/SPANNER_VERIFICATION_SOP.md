
# Spanner (Wrench) Modeling Verification Checklist

This checklist is for verifying the implementation of the Spanner (Wrench) model in the 3D-Builder UI.

## 1. Sketch & Extrude (Heads)
- [ ] Create a sketch on the **Top Plane**.
- [ ] Draw two circles:
    - Circle 1: Diameter **32mm**, centered at **(-52, 0)**.
    - Circle 2: Diameter **26mm**, centered at **(52, 0)**.
- [ ] Extrude both circles with **Mid Plane** condition (if available) or offset start to achieve centered extrusion of **6mm** thickness.
- [ ] Verify both heads are visible and correctly positioned.

## 2. Handle Construction
- [ ] Create a rectangle (Center Rectangle or Corner Rectangle) connecting the two circles.
- [ ] Dimensions: **104mm x 10mm**.
- [ ] Extrude the handle with **Mid Plane** condition or offset start for **3.5mm** thickness.
- [ ] Verify the handle is thinner than the heads and centered.

## 3. Wrench Openings (Cuts)
- [ ] **Side 1 (Large Head)**:
    - Create a cut-out (Hex or Rectangle) of **18mm** width.
    - Tilt the cut by **18 degrees**.
    - Ensure the cut removes material from the head.
- [ ] **Side 2 (Small Head)**:
    - Create a cut-out of **15mm** width.
    - Straight orientation (0 degrees).
- [ ] Verify both openings are correctly sized and through-all or deep enough to clear the heads.

## 4. Aesthetics & Fillets
- [ ] Add large **Fillets** (e.g., R10-R15) at the transitions between the heads and the handle.
- [ ] Verify the geometry is smooth and professional.

## 5. Technical Audit
- [ ] Check the **Feature Tree**: all features should be named appropriately (e.g., Head1, Head2, Handle, Cut1, Cut2).
- [ ] Check **Mass Properties**: Verify volume/mass if material is assigned.
