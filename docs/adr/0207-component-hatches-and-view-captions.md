# ADR 0207：分零件剖面線與可編輯視圖標籤

2026-10-26。採用。工程圖 Schema 31；零件84、組合件7不變。現況與未完成項只在[產品現況](../project-state.md)維護。

## 使用者問題與參考依據

組合件剖面把不同零件塗成相同方向，細部圖亦無法辨別；上視／投影視圖名稱、A-A及B (5:1)等自動文字不能獨立移位或編輯。使用者要求參照SolidCraft／SW／FreeCAD的做法。

已讀FreeCAD官方文件來源的[View](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TechDraw_View.md)（Caption屬性）、[SectionView](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TechDraw_SectionView.md)（填線旋轉／縮放及Fuse Before Cut）、[DetailView](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TechDraw_DetailView.md)（標籤／視圖拖動、比例）及[Hatch](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TechDraw_Hatch.md)（封閉區域、來源面、圖樣及縮放）。FreeCAD文件中拖標籤會移動視圖；本次依使用者要求，另提供只移標籤的操作。獨立可編輯Caption及切面來源是參考依據，沒有聲稱兩套軟體交互完全相同。

SW官方Area Hatch/Fill說明連線403；SolidCraft README僅能核對草圖與建模範圍，所查工程圖文件路徑404，未取得可證明同功能的來源。兩者只作操作慣例／呈現參考，不宣稱桌面實測或逐功能等效。抓取證據在忽略的`out/assembly-hatch-references/`。

## 剖面線決策

舊`projectDrawingView`把已定位零件join後只傳一組cut，scene執行一次even-odd填線，丟失組合件實例歸屬。修正保留整個組合件的原生隱藏線移除，再對各已定位實例取得真正的剖切邊界，以`SectionHatchRegion`傳過Worker。資料含實例leaf、原排列序號與原生cut，無剖切的實例也保留空集合，避免不同剖面間樣式重新編號。單零件及未剖視圖維持原路徑。

scene逐實例填線：第0件用視圖角度／線距，第1件轉90°，第2件回到原角度但線距乘1.25，之後每兩件增加0.25倍線距。預設前兩件為45°／135°（135°等同-45°）；同一零件的分離切域共用樣式，跨實例不合併掃線。同一來源實例排列下，一般、階梯、對正、局部剖面及其細部圖保留區分。裁剪／細部圖繼承完整分件邊界，先填線再裁切；斷裂仍由既有clip處理。

這些是重建資料，不把二維切面寫入3dbd，不新增持久幾何真值。現有剖面線角度／線距是整個視圖的基準，尚無逐零件手動選樣式面板；新增／刪除組合件實例可能改變自動排列序號。各實例增加原生切割／投影工作，沿用既有視圖快取；未認證大型組合件效能或OCCT無洩漏。

## 標籤操作與持久化

- 直接拖動視圖下方文字，只改標籤的紙面位移，不移動幾何、母視圖或整張圖的排列。拖動中預覽，放開一次命令；Esc取消；Ctrl／Command點標籤可切換視圖多選。視圖鎖定時標籤仍可編輯。
- 雙擊文字選中視圖並聚焦「標籤文字」欄。屬性新增「視圖名稱」、「剖面／細部代號」與「標籤文字」；編輯代號會同步母視圖箭頭或細部圈的代號。
- 標籤範本支援`<NAME>`、`<LABEL>`、`<SCALE>`。一般預設`<NAME>`，剖面預設`<LABEL>-<LABEL>`，細部圖預設`<LABEL> (<SCALE>)`。例如`細部 <LABEL> (<SCALE>)`在比例改成4:1後會同步；若使用者輸入純字面文字，該部分按自訂註記呈現。
- 「恢復標籤文字與位置」刪除覆寫。位置是相對自動標籤位置的紙面毫米，隨所屬視圖移動但不按視圖比例再放大；SceneText維護所屬view id供命中判斷，輸出仍取同一場景。

`DrawingView.caption`持久化文字範本與offset，模型命令及讀檔拒絕空文字、非字串、非法座標。v30→31不改既有幾何／投影／標籤，缺欄位使用原本位置與內容。Schema鏈路為model欄位／命令／驗證→migration／存讀→scene→畫布預覽／一次歷史→屬性；caption不新增幾何Ref或DAG。

這批是視圖標籤的自由二維位移，不代表尺寸數字的自由二維位移已完成。

## 證據與限制

- 118個功能／相關回歸案例各有通過紀錄：新分件剖面6、標籤5，原有相關107。原生相接套筒／軸的材料與中央孔探針、一般／階梯／對正／局部切面、空切域與第3件的3.75mm線距、衍生裁剪／細部圖、三種向量輸出、舊格式及新格式存讀。100組樣式×兩種比例使用真實原生剖面；100組標籤位置是排版檢驗，不冒充100個新實體。
- 3個瀏覽器流程各有通過紀錄：新增組合件流程，以及原有剖面樣式控制／持久化。實際Worker生成相接定位板的分件剖面與放大圖；標籤拖曳預覽、Esc、一次復原／重做、雙擊／Ctrl多選、名稱／代號／比例範本、恢復與存檔重開。最終`out/component-caption-final-ui.json`及`out/component-hatch-captions-ui.json`中兩個原有流程通過；後者含新腳本初輪失敗，不得稱整輪通過。截圖已檢視。
- 額外語系檢查4項通過，2項舊失敗：命名規則拒絕既有`instant3d.drag`，英文help keywords含既有中文搜尋字。以`git archive HEAD packages/i18n`取得未修改基準後，僅重跑這2項，重現相同失敗。證據`/tmp/caption-i18n-baseline.log`、忽略的`out/caption-i18n-baseline/`；未修改舊命名或放寬語系斷言。
- 新測試初輪使用不支援的crop母視圖、把crop誤當含圓形裁切，以及瀏覽器儲存helper名稱錯誤已修正；初期語系插入／migration位置及DXF聯合型別錯誤由typecheck攔下並修正。保留失敗紀錄，只重跑失敗／新增案例，未放寬容差或期限。
- typecheck、build、規則／分層／i18n靜態守門、文件盤點通過。原生heap讀取真實`oc.wasmMemory.buffer.byteLength`且基準>0；小批不見成長不等同零洩漏，`liveShapes`只驗暫存所有權。沒有全套通過、使用者原組合件實機或跨CAD認證宣稱。
