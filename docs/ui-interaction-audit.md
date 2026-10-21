# 介面交互審查：對照 SolidWorks 與 FreeCAD（2026-10-20）

> 範圍：工程圖、草圖、零件、組合件的「點選、預選、多選、右鍵選單、編輯、約束、磁吸（抓取）、移動、旋轉、鍵盤」。
> 參照：SolidWorks 官方 Help（2024 版為主，部分功能只找到較舊版本的頁面，已註明）與 FreeCAD 官方 Wiki（1.0／1.1／26.3）。所有參照都附連結，見文末「來源」。
> 本專案現況：以程式碼為證（檔案路徑），**工程圖部分另在真實 App 以 pointer 事件實測**；其他區塊是讀程式碼得出，標「讀碼」者尚未在 App 裡操作確認。

---

## 0. 結論先講（優先順序）

| # | 差距 | 區塊 | 等級 | 理由 |
|---|---|---|---|---|
| 1 | **3D 畫面按右鍵沒有特徵指令**（編輯特徵、編輯草圖、在面上畫草圖、隱藏、抑制、量測、對邊做圓角／倒角）。這些指令在「特徵樹」的右鍵都有，畫面上卻只有「選相切邊／迴圈／選擇其他」 | 零件 | **H** | 使用者明確反映「很多功能都可以加進右鍵選單」；SW 在面／邊上右鍵就是這些指令 |
| 2 | **草圖中按右鍵幾乎沒有東西**：選取模式下右鍵完全沒有選單；畫圖工具開著時只有「快速抓取」 | 草圖 | **H** | SW／FreeCAD 在草圖圖元上右鍵可加關係、標尺寸、切換構造線、刪除、選鏈、離開草圖 |
| 3 | **組合件沒有座標軸拖曳器（Triad／Dragger）**；3D 畫面的零組件右鍵選單（與樹共用 `ComponentMenu`）缺加入結合、移動、旋轉 | 組合件 | **H** | SW「以 Triad 移動」、FreeCAD「Std Transform」是精確擺放零件的主要方式；目前只能自由拖或在面板打數字 |
| 4 | **草圖沒有「移動／複製／旋轉／縮放圖元」工具**（也沒有草圖陣列） | 草圖 | **H** | SW Move/Copy/Rotate/Scale Entities、FreeCAD Sketcher Translate/Rotate/Scale 都是基本編輯 |
| 5 | **3D 畫面不能框選**（零件與組合件；草圖與工程圖可以） | 零件／組合件 | M | SW 零件、組合件、工程圖都能框選，左→右 窗選、右→左 跨選 |
| 6 | **組合件沒有 SmartMates**（Alt 拖曳到目標面即自動結合，Tab 翻轉對齊） | 組合件 | M | 加零件的速度差很多 |
| 7 | **零件沒有 Instant3D**（拖曳面／把手直接改擠出深度，帶尺規） | 零件 | M | SW 的直接修改方式 |
| 8 | **工程圖在沒有工具時沒有預選高亮**；**既有尺寸不能切換「顯示為半徑／直徑／線性」**；沒有倒角尺寸、基線尺寸 | 工程圖 | M | SW 有 Display Options；FreeCAD 有 M 鍵循環 |
| 9 | 草圖拖曳時不能「覆寫尺寸」、沒有「選取仍有自由度的圖元」 | 草圖 | L–M | SW Override dimensions on drag；FreeCAD SelectElementsWithDoFs |
| 10 | 部分組合件提示文字寫死在程式裡（`MovePanel.tsx` 的「自由拖曳」、`AssemblyViewport.tsx` 的拖曳提示） | 組合件 | L | 英文介面會出現中文；違反 i18n 規則 |

已經做得好的（不必再做）：草圖抓取的種類與 SW 幾乎一一對應、快速抓取、推論線、Ctrl 暫停抓取、Shift 長度步進；零件的預選高亮、選取篩選（F5／F6）、選擇其他、相切／迴圈選取；組合件沿自由度拖曳、右鍵旋轉、碰撞停止；SW 的視角快捷鍵（Ctrl+1…8、F、空白鍵）；工程圖的框選（窗選／跨選）、多選、批次修改、尺寸六種類型與右鍵選單（ADR 0177）。

---

## 1. 通用：選取與預選

| 項目 | SolidWorks | FreeCAD | 本專案 | 差距 |
|---|---|---|---|---|
| 預選高亮 | 游標經過即動態高亮 | 預選（hover）高亮 | 零件：邊、面、頂點都有（`Viewport.tsx` `onEdgeHover`／`onFaceHover`／`onVertexHover`）。工程圖：**只有尺寸、座標尺寸、隱藏邊工具開著時才高亮**（`DrawingViewport.tsx` `move` 中 `featureUnder` 的條件） | 工程圖 M |
| Ctrl／Shift 加選 | 有 | Ctrl 加選；Shift 範圍（樹） | 零件（`viewer.ts` `additive = ctrl||shift`）、草圖（`controller.ts` `select(..., e.ctrl||e.shift)`）、工程圖（`d.pick(..., 'toggle')`）、組合件樹（`AssemblyTree.tsx`）都有 | — |
| 框選（窗選／跨選） | 零件、組合件、工程圖皆可；左→右窗選，右→左跨選 | Std BoxSelection／BoxElementSelection | 草圖（`controller.ts` `this.box`）、工程圖（`selectionBox` 左→右窗選、右→左跨選）有；**零件與組合件 3D 沒有** | M |
| 套索選取 | 有 | 無 | 無 | L |
| 選擇其他（被擋住的） | Select Other 對話框 | 重複點擊同一處往上一層 | 零件右鍵「選擇其他」列出指標下的整疊面（`Viewport.tsx` `facesAt`）；工程圖、組合件沒有 | L |
| 選取篩選器 | 面、邊、頂點、尺寸、註記… | 無通用篩選器 | 零件、組合件有（面／邊／頂點／基準，F5、F6）；工程圖沒有 | L |
| 選取迴圈、相切鏈 | Select Loop／Tangency | 無 | 零件右鍵有（`topo.loop`、`tangentEdges`、`tangentFaces`） | — |
| 全選、反向選取、前一次選取 | 有 | Std SelectAll | 讀碼：**三者都沒有**（`actions.ts`、`viewKeys.ts` 無 Ctrl+A 或全選指令） | L |
| 放大鏡選取 | 有 | 無 | 無 | L |

## 2. 通用：右鍵選單

SolidWorks 在任何地方按右鍵，選單內容依指到的東西而定，並在選單上方附一排「選取工具」（框選、套索、篩選器、選擇其他）。FreeCAD 的 Sketcher Dimension、TechDraw Dimension 也可從右鍵選單叫出，並且**右鍵也用來結束連續工具**。

| 位置 | 本專案現況 | 應有（SW 為主） | 差距 |
|---|---|---|---|
| 工程圖畫布 | ADR 0177 後：依線／頂點／圓／圓弧列出尺寸類型；視圖有剖面、細部、尺寸與註記子選單、屬性、刪除；圖紙同樣有子選單；有工具時「結束目前的工具」 | — | 已補（實測 13/13） |
| 零件 3D 畫面 | 只有「相切邊、迴圈、相切面、選擇其他」（`Viewport.tsx` 179–201 行） | 面／邊上：編輯特徵、編輯草圖、在此面畫草圖、隱藏本體、抑制、量測、外觀；邊上：圓角、倒角；空白處：選取工具、視角 | **H** |
| 草圖（選取模式） | **沒有選單**（`onToolContextMenu` 對選取工具直接 `setMenu(null)`，208 行） | 圖元：加入關係（依選取列出可用的）、智慧型尺寸、構造線切換、刪除、選鏈、顯示／刪除關係；空白：離開草圖、草圖工具 | **H** |
| 草圖（畫圖工具中） | 只有「快速抓取」（`QUICK_SNAP_TOOLS`） | SW 同樣有 Quick Snaps，並加「結束工具」「選取」 | L |
| 組合件 3D 畫面 | 零組件上有右鍵選單（`AssemblyViewport.tsx` 107 行，沿用組合件樹的 `ComponentMenu`）；**缺加入結合、移動、旋轉**，部分標籤寫死中文 | 零組件：以 Triad 移動、隱藏、抑制、開啟零件、加入結合、孤立、外觀 | M |
| 特徵樹／組合件樹 | 有（編輯特徵、編輯草圖、隱藏、刪除、資料夾、上下層關係…） | — | — |

**建議作法**：比照 ADR 0177，把「樹的右鍵」與「畫面的右鍵」做成同一份命令定義（`actions.ts`），畫面上的右鍵只是多了「指標下是哪個面／邊／零組件」這個上下文。

## 3. 草圖

| 項目 | SolidWorks | FreeCAD | 本專案 | 差距 |
|---|---|---|---|---|
| 抓取種類 | 端點、中心、中點、象限、交點、最近、相切、垂直、平行、水平垂直線、水平垂直到點、長度（Shift）、格線、角度 | 格線、物件（邊與中點）、角度（Ctrl） | `packages/sketch/src/snaps.ts` 12 種＋格線＋角度：point、midpoint、curve、quadrant、intersection、tangent、perpendicular、alignment、horizontalVertical、lineRelations、extension、model；Shift 長度步進、Ctrl 暫停抓取（`controller.ts` 672、795 行） | — |
| 快速抓取 | 右鍵 → Quick Snaps，只開一種 | 無 | 有（`quickSettings`、`setQuickSnap`） | — |
| 推論線與游標符號 | 有 | 自動約束圖示、方向輔助線（26.3） | 有（`inference`、`inferLine`） | — |
| 自動關係開關 | 可與抓取分開關閉 | Auto constraints 每張草圖一個開關 | **實測（2026-10-20）**：沒有獨立的自動關係開關。關係與抓取綁在一起：同一條接近水平的線，抓取全開 → 加上「水平」；只關「水平線與垂直線」抓取 → 沒有關係；關掉抓取總開關 → 沒有關係。也就是說，**要抓取就一定加關係**，無法「保留抓取、不加關係」 | L–M |
| 拖曳未完全定義的圖元 | 可；藍色＝未定義、黑色＝完全定義 | 可；26.3 起拖曳時也加自動約束 | 有（`startDrag`／`dragTo`，求解預覽後提交 `setSketchGeometry`） | — |
| 拖曳時覆寫尺寸 | Override dimensions on drag/move | 無 | 無 | L |
| 移動／複製／旋轉／縮放／延展圖元 | Move、Copy、Rotate、Scale、Stretch Entities（含「保持關係」） | Sketcher Translate（含陣列）、Rotate、Scale | **無**（`SKETCH_TOOLS` 沒有；`ops.ts` 只有 stretch 字樣） | **H** |
| 草圖陣列 | 線性、環狀草圖陣列 | Translate／Rotate 帶副本數 | 無 | M |
| 橢圓、雲形線工具 | 有 | 有 | 幾何核心支援（`ops.ts`、`planegcs.ts`、`profiles.ts` 有 ellipse／spline），**工具列沒有工具** | M |
| 畫圖時直接輸入數值 | PropertyManager 參數 | On-View-Parameters：游標旁輸入座標／長度／角度，Enter 即加上約束 | 讀碼：**沒有找到畫圖中輸入數值的機制**（無 OVP 相關程式） | M |
| 尺寸類型切換 | 放置時右鍵選水平／垂直／座標… | M 鍵循環候選約束 | 讀碼：由放置位置決定；無循環鍵 | L |
| 自由度與衝突 | 狀態列顯示；顏色 | 對話框顯示自由度數，點一下選取仍有自由度的圖元；點一下選取衝突約束 | 狀態列與顏色有（`StatusBar.tsx`、`overlay.ts` 有 redundant／conflict）；**「選取仍有自由度的圖元」沒有** | M |
| Esc／右鍵結束連續工具 | Esc | Esc 或右鍵 | Esc | L |

## 4. 零件

| 項目 | SolidWorks | FreeCAD | 本專案 | 差距 |
|---|---|---|---|---|
| 畫面右鍵特徵指令 | 有 | 3D 畫面右鍵有 Transform 等 | **無**（見 §2） | **H** |
| 直接拖曳修改（Instant3D） | 拖曳面上的把手改深度，帶尺規，Alt 拖到另一面貼齊 | 無（用 Transform 移動物件） | 無（只有剖面平面可拖、尺寸標籤可拖） | M |
| 雙擊特徵顯示尺寸並就地修改 | 有 | 雙擊進入編輯 | **實測（2026-10-20）**：在 3D 畫面雙擊伸長的面，只會選取該面，`editing` 仍為 null，畫面上不出現尺寸也沒有輸入框。`onLabelDoubleClick` 只用於**草圖中**的尺寸標籤。要改特徵尺寸只能在設計樹雙擊（或右鍵「編輯特徵」）開 PropertyManager | M |
| 量測 | 有 | 有 | 有（`MeasurePanel.tsx`） | — |
| 框選 | 有 | 有 | **無** | M |
| 參考三軸 | 有 | 有 | 有（`viewer.ts` `buildTriad`，僅顯示方向，不能拖） | — |

## 5. 組合件

| 項目 | SolidWorks | FreeCAD | 本專案 | 差距 |
|---|---|---|---|---|
| 拖曳零組件 | 沿結合留下的自由度移動；拖曳面與視角平行 | 拖曳、或 Transform | 有：左鍵移動、右鍵旋轉，只沿自由度（`AssemblyViewport.tsx`、`movability.ts`） | — |
| 精確移動／旋轉 | 移動零組件 PM：自由拖曳、沿實體、依 ΔXYZ、到 XYZ；旋轉：依角度 | Transform 面板：增量、絕對、自訂座標系 | 有：移動「自由／依／到」、旋轉「自由／依」（`MovePanel.tsx`） | — |
| 座標軸拖曳器 | Move with Triad：拖軸、拖平面、拖環旋轉；中心球右鍵輸入座標；Alt 拖到邊或面對齊；右鍵環「旋轉 90°／180°」 | Dragger：軸箭頭、平面、球；平移與旋轉的步進貼齊；可把 Dragger 貼到任一元素 | **無** | **H** |
| 碰撞偵測 | 停在碰撞處、只檢查被拖的零件、高亮、聲音；物理動態 | 無 | 有「碰撞時停止」與紅色標示（`collisionStop`、`setCollidedComponents`）；無物理動態 | L |
| SmartMates | Alt 拖曳元素到目標，預覽結合類型，Tab 翻轉對齊；圓邊對圓邊得到同心＋重合 | 無 | **無** | M |
| 結合對齊翻轉 | Tab 或 PM 按鈕 | 有 | PM 按鈕（`MatePanel.tsx` aligned／antiAligned、反轉尺寸） | L（缺 Tab 快捷） |
| 畫面右鍵 | 有 | 有 | 有（與樹共用 `ComponentMenu`），缺結合／移動／旋轉 | M |
| 文字 i18n | — | — | `MovePanel.tsx` 113、147 行「自由拖曳」，`AssemblyViewport.tsx` 246、258 行的拖曳提示寫死中文 | L |

## 6. 工程圖（ADR 0177 之後）

| 項目 | SolidWorks | FreeCAD TechDraw | 本專案 | 差距 |
|---|---|---|---|---|
| 智慧型尺寸 | 一條線＝線長、圓＝直徑、弧＝半徑、兩元素＝距離或角度 | Dimension（D）：依選取提議，M 鍵循環，右鍵或 Esc 結束，連續模式 | 有，含單選線長（ADR 0177 修正）；工具保持類型 | — |
| 指定類型 | 水平、垂直、座標、基線、倒角（右鍵選單） | 各類型獨立工具，或單一工具＋下拉 | 水平、垂直、對齊、角度、半徑、直徑（工具列 ▾ 與右鍵）；座標尺寸另有工具；**無基線、倒角** | M |
| 既有尺寸改成半徑／直徑／線性 | Display Options | — | **無**（只能刪掉重標） | M |
| 預選高亮 | 有 | 有 | 只有工具開著時 | M |
| 右鍵選單 | 有 | 有 | 有（ADR 0140／0141／0177） | — |
| 選取篩選器 | 有 | 無 | 無 | L |

## 7. 鍵盤

| 項目 | SolidWorks | 本專案 | 差距 |
|---|---|---|---|
| 視角 | Ctrl+1…8、F、空白鍵（視角方向） | 一致（`actions.ts`、`viewKeys.ts`） | — |
| 篩選器 | F5 開關、F6 清除 | 一致 | — |
| S 鍵快捷列 | 游標處跳出常用工具 | 無 | L |
| Enter 重複上一個指令 | 有 | 無 | L |
| 滑鼠手勢 | 右鍵拖曳出八方向指令 | 無（右鍵拖曳是平移） | L |
| 自訂快捷鍵 | 有 | 有（`shortcuts.ts` 覆寫） | — |

---

## 8. 建議分批（每批一個 ADR，沿用 ADR 0177 的作法與驗收方式）

1. **畫面右鍵統一（零件、草圖、組合件）**——差距 #1、#2、#3 的選單部分。共用 `actions.ts`，依指標下的對象（面、邊、頂點、草圖圖元、零組件）決定項目；選單項目與樹的右鍵一致。驗收：每類對象一支 e2e，斷言選單項目與執行後的文件狀態；0 Console 錯誤。**已完成：ADR 0176**（`tests/e2e/manual-context-menus.js`）。更正本報告：組合件 3D 畫面原本**已有**零組件右鍵選單（`AssemblyViewport` → `ComponentMenu`），缺的是結合、移動、旋轉與空白處的選單。
2. **草圖移動／複製／旋轉／縮放圖元（含「保持關係」）與草圖陣列**——差距 #4。驗收：以求解器結果比對座標（真值由變換矩陣推導），保持關係開與關兩種，Fuzz。**已完成：ADR 0177**（`apps/web/test/sketch-transform.test.ts`、`tests/e2e/manual-c27.js`、手冊 C27）。未做：延展圖元（Stretch Entities）、陣列副本與原圖元連動、線性陣列的第二方向。
3. **組合件 Triad**——拖軸、拖平面、拖環、步進貼齊、中心輸入座標，只沿結合自由度；驗收：拖曳後的位姿以矩陣比對、受限方向不動。
4. **3D 框選、SmartMates、Instant3D**——差距 #5–#7，依使用頻率排序。
5. **工程圖補完**——預選高亮、顯示為半徑／直徑／線性、基線與倒角尺寸。
6. **小項**——Enter 重複指令、Tab 翻轉結合、選取仍有自由度的圖元；獨立的「自動關係」開關（保留抓取、不加關係）；在 3D 畫面雙擊特徵顯示其尺寸並可就地修改（2026-10-20 實測確認為缺口）。i18n 寫死文字中 `MovePanel`、`AssemblyViewport` 已隨 ADR 0176 完成。

## 9. 限制與未查證

- 第 3–5 節「讀碼」的項目沒有在 App 裡操作確認。原本標「待查」的兩項（自動關係是否可單獨關、雙擊特徵顯示尺寸）已於 2026-10-20 在 App 中實測，結果見 §3、§4：兩者都是缺口，列入第 6 批。
- SolidWorks 的 Triad、SmartMates、Instant3D、Move/Rotate Entities、Display Options 只找到 2011–2017 版的 Help 頁面，名稱或位置在新版可能略有不同。
- FreeCAD 的 Assembly 拖曳與 Dragger 細節以 Std TransformManip 頁面為準；Assembly 工作台本身的拖曳說明頁面不存在（Assembly CreateJoint 頁面為空）。

## 來源

SolidWorks Help：
- [Inferencing（2024）](https://help.solidworks.com/2024/english/SolidWorks/sldworks/c_Inferencing.htm)
- [Sketch Snaps（2024）](https://help.solidworks.com/2024/english/SolidWorks/sldworks/c_Sketch_Snaps.htm)
- [Selection（2024）](https://help.solidworks.com/2024/english/SolidWorks/sldworks/c_Selection_Overview.htm)
- [Selection Context Toolbar（2024）](https://help.solidworks.com/2024/english/SolidWorks/sldworks/c_Selection_Tool_access.htm)
- [Dimensioning a 2D Sketch（2021，尺寸類型的右鍵選單）](https://help.solidworks.com/2021/English/SolidWorks/Sldworks/t_Dimensioning_a_2D_Sketch.htm)
- [Formatting Dimensions in Drawings（2015，Display As Radius／Diameter）](https://help.solidworks.com/2015/English/SolidWorks/Sldworks/c_Formatting_Dimensions_in_Drawings.htm)
- [Using a Triad to Move a Component（2015）](https://help.solidworks.com/2015/English/SOLIDWORKS/sldworks/t_using_triad_move_component.htm)
- [Using a Triad to Rotate a Component（2016）](https://help.solidworks.com/2016/English/SOLIDWORKS/sldworks/t_using_triad_rotate_component.htm)
- [Collision Detection（2017）](https://help.solidworks.com/2017/English/SolidWorks/sldworks/t_Collision_Detection_SWassy.htm)
- [Creating SmartMates（2025）](https://help.solidworks.com/2025/English/SolidWorks/Sldworks/t_Creatiing_SmartMates_SWassy.htm)
- [Moving or Copying Sketch Entities（2017）](https://help.solidworks.com/2017/English/SolidWorks/sldworks/t_Moving_or_Copying_Sketch_Entities.htm)
- [Rotating Sketch Entities（2017）](https://help.solidworks.com/2017/english/SolidWorks/sldworks/t_Rotating_Sketch_Entities.htm)
- [Overview of Instant3D Functionality（2017）](https://help.solidworks.com/2017/English/SolidWorks/sldworks/c_instant3d_functionality.htm)、[Instant3D Rulers（2017）](https://help.solidworks.com/2017/English/SolidWorks/sldworks/c_instant3d_rulers.htm)

FreeCAD Wiki：
- [TechDraw Dimension](https://wiki.freecad.org/TechDraw_Dimension)
- [Sketcher Dimension](https://wiki.freecad.org/Sketcher_Dimension)
- [Sketcher Dialog（抓取、自動約束、自由度、約束清單右鍵）](https://wiki.freecad.org/Sketcher_Dialog)
- [Sketcher Workbench：Drawing aids（連續模式、自動約束、輔助線、On-View-Parameters）](https://wiki.freecad.org/Sketcher_Workbench)
- [Selection methods](https://wiki.freecad.org/Selection_methods)
- [Std TransformManip（Dragger）](https://wiki.freecad.org/Std_TransformManip)
- [Assembly Workbench](https://wiki.freecad.org/Assembly_Workbench)
