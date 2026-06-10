# SolidWorks Expert Guide: Loft Curvature & Advanced Boundary Logic

**Source**: [YouTube: How to Apply Start and End Constraints to Solidworks Loft Features](https://www.youtube.com/watch?v=AGDV78Jmo3k)
**Reference**: Standard SOLIDWORKS 2000+ Advanced Surfacing

## 1. Advanced Loft Boundary Constraints
Loft boundaries define how the generated surface transitions from the starting/ending profiles and any adjacent geometry.

### A. Tangent to Face (切線於面)
- **Scenario**: When a loft starts from a profile that lies on an existing solid face.
- **Requirement**: The new surface must share the same tangent plane as the parent face at every point along the profile.
- **Project Gap**: Currently, we only support a single "normal" vector for the whole profile. For non-planar faces, this is incorrect. We need to support **Face References** to extract local normals.

### B. Curvature to Face (曲率於面 - G2)
- **Requirement**: Not only are the tangents equal (G1), but the rate of change of the tangent (curvature) is also continuous (G2).
- **Project Gap**: Our solver currently uses `GeomAbs_C1`. We should support `GeomAbs_C2` for high-end aesthetic components (Class-A surfacing).

### C. Thin Feature (薄件特徵)
- **Function**: Automatically hollowing out the lofted solid by a specified wall thickness.
- **Requirement**: Integrates a `SHELL` operation directly into the `LOFT` feature.

## 2. 專案對標缺口 (Gap Checklist)
- [ ] **G2 Continuity**: Backend needs to set `GeomAbs_C2` when requested.
- [ ] **Face-Based Tangency**: `PartFeaturePropertyManager.tsx` needs specific selection boxes for "Start/End Face References" to enable true Tangent/Curvature to Face.
- [ ] **Thin Loft**: Lacks the `isThin` parameter and subsequent hollowing logic.

## 3. 預期行為 (SOP)
1. 繪製兩個分離的剖面。
2. 啟動 **Lofted Boss/Base**。
3. 選取剖面。
4. 在 Start/End Constraints 選單中，選擇 **Curvature to Face** (需選取起始/結束面)。
5. 觀察生成的曲面更加圓滑且無明顯稜角。
