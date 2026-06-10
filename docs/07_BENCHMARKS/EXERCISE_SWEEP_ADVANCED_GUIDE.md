# SolidWorks Expert Guide: Advanced Sweep Orientation & Guides

**Source**: [YouTube: How to Apply Start and End Constraints to Solidworks Loft Features](https://www.youtube.com/watch?v=_-kADsdzzYg) (Note: Playlist progression often blends Sweep/Loft advanced boundary logic)
**Reference**: Standard SOLIDWORKS 2000+ Advanced Sweeping

## 1. Advanced Sweep Orientation Logic
In SolidWorks, a **Sweep** is defined by a profile and a path, but its real complexity lies in how the profile is oriented as it travels along the path.

### A. Profile Orientation (剖面方位)
1. **Follow Path (隨路徑變化)**: The profile maintains its normal relative to the path's tangent at every point. This is the default.
2. **Keep Normal Constant (保持法向不變)**: The profile maintains its initial orientation relative to the world or sketch plane, regardless of path curvature.
3. **Project Gap**: Currently, our `BRepFill_PipeShell` implementation defaults to "Follow Path". We lack a UI switch and logic for "Constant Normal" or custom orientation vectors.

### B. Guide Curves (引導曲線)
- **Function**: One or more secondary paths that "pull" the profile's shape or orientation as it sweeps.
- **Requirement**: The profile must intersect (Coincident/Pierce) all guide curves.
- **Project Status**: Backend `geometry_service.py` has `sweep_tool.SetGuide(guide_wire)`, but Frontend lacks a selection box for multiple guide curves.

### C. Start/End Tangency
- **Scenario**: Sweeping into or out of an existing solid.
- **Requirement**: Forcing the start or end of the sweep to be tangent to adjacent faces.
- **Project Gap**: Similar to Loft, Sweep needs "Start/End Constraints" (None, Path Tangency, Direction Vector).

## 2. 專案對標缺口 (Gap Checklist)
- [ ] **Orientation Modes**: Lacks support for "Fixed Normal" in `BRepFill_PipeShell`.
- [ ] **Guide Curve UI**: `PartFeaturePropertyManager.tsx` only shows one "Path" selection; needs a multi-selection rollout for "Guide Curves".
- [ ] **Pierce Points**: Automatic detection/enforcement of profiles touching guide curves.

## 3. 預期行為 (SOP)
1. 繪製剖面與路徑。
2. 繪製一條或多條引導曲線 (Guide Curves)。
3. 啟動 **Swept Boss/Base**。
4. 選取剖面、路徑，然後選取引導曲線。
5. 觀察生成的實體形狀如何隨引導曲線變形（如：瓶身縮放或扭轉）。
