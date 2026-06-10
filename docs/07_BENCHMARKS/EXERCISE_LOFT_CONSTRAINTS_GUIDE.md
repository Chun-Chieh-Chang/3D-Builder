# SolidWorks Expert Guide: Loft Start/End Constraints (Focus: gxIlg9irqHU)

**Source**: [YouTube: How to apply constraints to the loft feature in SolidWorks](https://www.youtube.com/watch?v=gxIlg9irqHU)
**Reference**: Standard SOLIDWORKS 2000+ Surfacing

## 1. Professional Loft Boundary Constraints
Start and End constraints are the "steering wheel" for lofted surfaces. They allow you to control the surface normal and curvature without adding guide curves.

### A. Normal to Profile (垂直於輪廓)
- **Effect**: The surface exits the profile at exactly 90 degrees.
- **SolidWorks behavior**: Provides a "Magnitude" (Weight) slider to increase or decrease the "bulge".
- **Draft Angle Integration**: You can add a draft angle to flare the surface out or taper it in while maintaining the tangency behavior.

### B. Tangent to Face (切線於面)
- **Effect**: The surface matches the slope of an adjacent face.
- **Requirement**: The profile must be on an edge or face of an existing solid.
- **Critical Detail**: For curved faces, the tangency must be **local**. Every point on the profile must follow the underlying face normal.

### C. Direction Vector (方向向量)
- **Effect**: The surface exits in a direction defined by a selected line, edge, or axis.
- **Use Case**: Aerodynamic ports or intake manifolds where flow direction is fixed.

## 2. 專案對標缺口 (Gap Checklist)
- [x] **Normal to Profile**: Implemented via auxiliary section offset.
- [x] **Direction Vector**: Implemented via custom offset vector.
- [x] **Draft Angle**: Implemented via radial scaling of auxiliary section.
- [ ] **Local Normal Tangency**: Currently, our `TANGENT_TO_FACE` uses a global face normal. It needs to sample local normals for curved faces (e.g., lofting from a cylinder).
- [ ] **Point Lofting**: The system lacks the ability to loft from a profile to a single sketch point (Vertex Loft).

## 3. 預期行為 (SOP)
1. 建立一個具有曲面的實體（如圓柱）。
2. 在曲面的一個邊緣或面上建立草圖。
3. 建立第二個偏置草圖。
4. 啟動 **Loft**，選取兩草圖。
5. 設定起始約束為 **Tangent to Face**。
6. 觀察生成曲面與圓柱面的無縫銜接。
