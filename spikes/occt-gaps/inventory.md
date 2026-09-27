# OCCT 綁定盤點

- replicad-opencascadejs 1.1.0：27/46
- libcascade 3.0.2：44/46

| Phase | 目錄 ID | 類別 | 用途 | replicad-opencascadejs 1.1.0 | libcascade 3.0.2 |
|---|---|---|---|---|---|
| 1 | A1.5 C4.2 | `BRepAlgoAPI_Fuse` | 填料合併 | 有 | 有 |
| 1 | A1.5 C4.2 | `BRepAlgoAPI_Cut` | 伸長/旋轉除料 | 有 | 有 |
| 1 | A1.5 C7.2 | `BRepAlgoAPI_Common` | 共同、干涉體積 | 有 | 有 |
| 1 | A1.5 | `BRepAlgoAPI_Splitter` | 分割 | 有 | 有 |
| 1 | A1.5 | `ShapeUpgrade_UnifySameDomain` | 布林後合併共面/共圓柱面 | 有 | 有 |
| 1 | B4.1 | `BRepTools_History` | 合併共面後的面演化歷史（持久命名） | **缺** | 有 |
| 1 | B4.1 | `TopTools_IndexedMapOfShape` | 形狀索引 | **缺** | 有 |
| 1 | B4.1 | `TopExp` | MapShapes / 鄰接 | **缺** | 有 |
| 1 | C4.3 | `BRepPrimAPI_MakeRevol` | 旋轉 | 有 | 有 |
| 1 | C5.3 | `BRepFilletAPI_MakeChamfer` | 導角 | 有 | 有 |
| 1 | F2.1 | `STEPControl_Reader` | STEP 零件輸入（無名稱/顏色） | 有 | 有 |
| 1 | F2.1 F2.8 | `STEPCAFControl_Reader` | STEP 輸入含名稱、顏色、組合件結構 | **缺** | 有 |
| 1 | F2.2 | `ShapeFix_Shape` | 輸入修復（整體） | **缺** | 有 |
| 1 | F2.2 | `ShapeFix_Solid` | 輸入修復（實體） | 有 | 有 |
| 1 | F2.2 | `ShapeFix_Shell` | 輸入修復（殼） | **缺** | 有 |
| 1 | F2.2 | `ShapeFix_Face` | 輸入修復（面） | 有 | 有 |
| 1 | F2.2 | `ShapeFix_Wire` | 輸入修復（線框） | 有 | 有 |
| 1 | F2.2 | `ShapeAnalysis_FreeBounds` | 找開放邊界（破面診斷） | **缺** | 有 |
| 1 | F2.2 | `BRepBuilderAPI_Sewing` | 縫合面成殼 | 有 | 有 |
| 1 | E1.1 | `BRepExtrema_DistShapeShape` | 量測距離 | 有 | 有 |
| 3a | C4.4 | `BRepOffsetAPI_MakePipeShell` | 掃出 | 有 | 有 |
| 3a | C4.5 | `BRepOffsetAPI_ThruSections` | 疊層拉伸 | 有 | 有 |
| 3a | C5.4 | `BRepOffsetAPI_MakeThickSolid` | 薄殼 | 有 | 有 |
| 3a | C5.5 | `BRepOffsetAPI_DraftAngle` | 拔模 | 有 | 有 |
| 3a | C6.1-3 | `BRepBuilderAPI_Transform` | 複製排列、鏡射 | 有 | 有 |
| 3a | C6.1-3 | `gp_Trsf` | 變換 | 有 | 有 |
| 3a | C4.7 | `BRepFeat_MakeLinearForm` | 肋材（備案：伸長 + 布林） | **缺** | **缺** |
| 3a | C10.1 | `BRepOffset_MakeOffset` | 移動/偏移面（逐面偏移） | **缺** | **缺** |
| 3a | C10.1 | `BRepOffsetAPI_MakeOffsetShape` | 偏移 | 有 | 有 |
| 3a | C10.2 | `BRepAlgoAPI_Defeaturing` | 刪除面、刪除鑽孔 | **缺** | 有 |
| 3a | C14.2 F1.1 | `Quantity_ColorRGBA` | 顏色輸出 | 有 | 有 |
| 3a | C14.2 F1.1 | `Quantity_TypeOfColor` | 以 sRGB 指定顏色 | **缺** | 有 |
| 3b | F2.8 | `XCAFDoc_ShapeTool` | 組合件結構讀寫 | 有 | 有 |
| 3b | E2.1 | `BRepAlgoAPI_Check` | 布林前檢查 | **缺** | 有 |
| 3b | F4.1 | `StlAPI_Writer` | STL 輸出 | 有 | 有 |
| 4a | A3.6 | `BRepExtrema_ShapeProximity` | 碰撞/接近偵測 | **缺** | 有 |
| 4b | C9.2 | `BRepOffsetAPI_MakeFilling` | 填補曲面 | 有 | 有 |
| 4b | C8.1 | `BRepFeat_SplitShape` | 分割線 | **缺** | 有 |
| 4b | C8.1 | `BRepAlgoAPI_Section` | 截交線 | 有 | 有 |
| 5 | A4.4 | `HLRBRep_Algo` | 精確隱藏線 | 有 | 有 |
| 5 | A4.4 | `HLRBRep_PolyAlgo` | 多邊形隱藏線（快速預覽） | **缺** | 有 |
| 5 | A4.4 | `HLRBRep_HLRToShape` | 隱藏線結果轉邊線 | 有 | 有 |
| 6 | E3.2 | `BRepLProp_SLProps` | 拔模分析（面法向） | **缺** | 有 |
| 6 | E3.5 | `IntCurvesFace_ShapeIntersector` | 厚度分析（射線求交） | **缺** | 有 |
| P2 | F1.4 F2.2 | `IGESControl_Writer` | IGES 輸出 | **缺** | 有 |
| P2 | F1.4 F2.2 | `IGESControl_Reader` | IGES 輸入 | **缺** | 有 |
