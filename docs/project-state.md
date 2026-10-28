# 產品現況與能力邊界

更新日期：2026-10-27。現況以本檔維護；版本與可重算數量見[自動盤點](repository-inventory.md)，每次交付的證據見[DEV_LOG](../DEV_LOG.md)。此處不將舊階段文件的測試數冒充本版全量結果。

## 交付與驗收分開

Phase 0–7範圍已有開發成果；原Phase 0–2閘門按當時較低範圍通過，3a–7仍是有條件通過。2026-10-23已有公開STEP樣本、FreeCAD匯入與DXF／PDF外部應用程式探針，不能再說完全沒有真實檔案驗證；也不能因此宣稱SolidWorks特徵歷史相容或製造認證。FreeCAD同樣使用OCCT，並非獨立幾何核心基準。

目前Web版與Windows Tauri殼共用同一前端建置及文件模型。Linux雲端可驗Web與原生WASM；本輪未建置或操作Windows桌面安裝檔，未宣稱macOS／Linux桌面版認證。`.sldprt`／原生SolidWorks特徵樹不在目前讀取範圍。

## 已交付功能與仍有的邊界

| 類別 | 已存在 | 邊界／依據 |
|---|---|---|
| 零件建模 | 草圖驅動拉伸／旋轉／掃出／疊層拉伸、圓角／導角、薄殼、多本體與曲面 | 經文件命令與原生核心重建；輸入失敗須回報，不能以圖形假冒幾何；[藍圖](blueprint.md)與ADR |
| 草圖關係 | 批次拘束、等距／比例、對稱、端點／內外相切、橢圓與Bézier G1、修復診斷；關係不能靠把直線壓成一個點來滿足，會轉動或移動，壓不出來就拒絕並說明（[ADR0211](adr/0211-relations-do-not-shrink-lines.md)）；智慧型尺寸可點兩條線真的交叉的地方，尺寸放下時才建立點與交點關係（[ADR0212](adr/0212-line-crossing-as-dimension-reference.md)，不含延長線交點與圓弧交點）；已經成立的同心／同心同徑不再被提供或要求，被拒絕時說明是「已被決定」還是「過多定義」（[ADR0213](adr/0213-relations-that-already-hold.md)） | 不含一般樣條G2或最小衝突集合；[ADR0195](adr/0195-sketch-constraint-expansion.md) |
| 齒輪／齒條 | 參數式直齒齒輪、直齒齒條 | 不含斜齒、內齒、變位、滾刀齒根或運動結合；[ADR0193](adr/0193-gear-and-rack-builders.md) |
| 選面圓角／導角 | 可預選面、多面與邊混選，重建時展開有效邊界；正式「螺紋入口錐面」工具 | 已重現原模型的自由曲面邊導角限制；可由孔口邊／面直接建立可編輯加工錐面；需唯一同軸圓弧，不能推測任意曲線孔口；[ADR0205](adr/0205-thread-entrance-tool.md) |
| 模型互動 | 浮動參數、合法運算式預覽、建構拉伸拖曳／跨平面反向／對稱 | 操控器限有原生終端面的給定深度／對稱第一方向；運算式深度不強制覆寫；[ADR0203](adr/0203-floating-editor-assembly-source-and-live-extrusion.md) |
| 組合件編輯 | 雙擊／右鍵來源零件草圖或特徵，儲存返回後更新來源實例 | 同時一份文件，不是組合件就地編輯；直接特徵編輯限3dbx；[ADR0203](adr/0203-floating-editor-assembly-source-and-live-extrusion.md) |
| 顯示 | 固定工作平面的網格、正確深度、右鍵與系統選項同步、參考面共原點、隱藏恢復、透明塗彩 | 同一零件的三預設面共自身原點，實例保留位姿，自訂面保留偏移；[ADR0202](adr/0202-viewport-grid-and-hidden-recovery.md)、[ADR0197](adr/0197-transparent-shaded-view.md) |
| 工程圖 | 新建預設第三角法、選取模式可拖曳／編輯視圖標籤與連動比例範本、多圖頁、孔／螺紋標註、樣式預設、側視引線、公差等級註記、解析錐面側視倒角標註與模型連動、尺寸線／文字拖曳、延伸線從可見輪廓引出、圓心／端點／中點／圓四分點提示與持久參照、組合件解析輪廓選取、固定像素高亮與畫布線寬、R↔Ø切換與去重 | 螺紋規格不從真實螺旋拓樸反推；公差等級註記不是極限尺寸求值；[ADR0185](adr/0185-drawing-thread-leaders-defaults-tolerances.md)、[ADR0192](adr/0192-dimension-line-drag.md)、[ADR0206](adr/0206-drawing-dimension-interaction.md)、[ADR0207](adr/0207-component-hatches-and-view-captions.md)、[ADR0208](adr/0208-drawing-reference-points.md)、[ADR0209](adr/0209-conical-chamfer-dimensions.md) |
| 投影參照與偏差 | 實際顯示 HLR 直線參照、自由曲線投影取點；剖切／細部／折斷共用幾何；單一及批次非對稱／單向偏差 | 投影簽名匹配目前輪廓，幾何變更失配需重選；不從自由曲線猜 R／Ø／倒角；偏差仍行內排版；[ADR0210](adr/0210-projected-references-and-asymmetric-tolerances.md) |
| 剖面與剖面線 | 一般／斜向／階梯／對正／局部剖面，分零件實例填線、線距與角度 | 目前自動分件樣式，未提供逐件手動樣式；裁剪／放大繼承與母視圖限制仍有效；[ADR0198](adr/0198-section-hatch-regions-and-style.md)、[ADR0207](adr/0207-component-hatches-and-view-captions.md) |
| 鈑金 | 多道與局部展開、相容的展開加工／摺回、原生展平尺寸與折彎表 | 封閉基材與單一本體；未展開曲面／變截面斜向加工／加料拒絕；任意STEP轉鈑金未開放；[ADR0199](adr/0199-sheet-manufacturing-workflow.md)、[ADR0200](adr/0200-sheet-partial-unfold-curved-machining.md) |
| 圖示與選單 | SolidCraft授權圖示＋完整文字、現有CommandBar | 新Ribbon分組／搜尋仍是[獨立設計稿](design/menu-redesign/plan.md)，不能當正式介面；[ADR0201](adr/0201-solidcraft-icons-and-menu-design.md) |
| 輸出與驗證 | STEP、SVG、DXF、PDF；公開樣本與外部應用程式探針 | AutoCAD／SHX、使用者製造基準與實體列印未認證；[自動驗收](automated-acceptance.md) |

## 待辦與已知問題

- 兩項既有語系規則測試失敗：`instant3d.drag`不符舊key正規式、英文help搜尋keywords含中文。於未修改的`60bfd9a`語系來源重現；本批新增字典完整性4項通過，未改斷言，見[ADR0207](adr/0207-component-hatches-and-view-captions.md)。
- 工程圖尺寸對照後續：平面直邊導角參數隨模型重建求值、文字自由二維偏移、持久交點／虛交點參照及跨尺寸對齊磁吸。當前文字沿線／角度弧獨立拖曳，圓心、端點、中點、圓四分點與完整圓柱輪廓點已驗，舊格式v24／30／31零件與組合件冷啟動量測通過，尚未取得使用者實際舊工程圖；原生兩完整圓邊界錐面的側視倒角已連動模型數字與引線（ADR0209），其他平面直邊導角仍需真實形狀投影及實際端點，並確認可編輯註記值；不能宣稱全面辨識三維導角或與SW完全等效。依據見[ADR0206](adr/0206-drawing-dimension-interaction.md)。
- 影片[ M5KOgtk9VfI ](https://www.youtube.com/watch?v=M5KOgtk9VfI)：尚未取得可讀內容。先前YouTube／oEmbed／搜尋連線403，需影片標題、操作說明或關鍵影像，不能猜功能。
- 正式Ribbon配置／搜尋、投影線本體作掃出路徑、連動陣列事後群組編輯、其他特徵操控器、組合件就地編輯仍為後續工作；不得把規劃標為已完成。
- 兩項`context-menus.test.ts`舊失敗已於2026-10-26處理：清單納入伸展；移動案例補上真實的草圖編輯狀態，並保留閒置狀態應拒絕指令的斷言。實際瀏覽器驗證右鍵子選單與線段兩端移動通過，並納入CI；沒有移除產品的啟用檢查。歷史與修正見[ADR0201](adr/0201-solidcraft-icons-and-menu-design.md)。
- 螺紋導角：取得原檔重現原生起始解失敗後，已完成正式「特徵→螺紋入口錐面」。選平面孔口或其內邊，工具辨識原生內輪廓，建立持久中心、附著草圖及錐孔，一次取消／復原；多孔面需選邊消歧，缺圓弧或外緣不猜軸。原始零件與合成模型都透過正式工具驗證；孔徑／入口直徑／夾角／深度及方向可編輯，工序提示區分先導角再切牙與加牙後修整。沿任意螺旋邊等距導角仍受OCCT限制，不能混稱修復；[ADR0205](adr/0205-thread-entrance-tool.md)。
- OCCT布林／投影的WASM Heap成長與Worker回收邊界見[AGENTS](../AGENTS.md)及[ADR0126](adr/0126-worker-heap-recycling.md)；handles不是零洩漏證據。
- 私有樣本與本機資料不在版本庫；本機Windows仍需拉取正式提交、重啟與強制重新整理。雲端通過不等同使用者本機已驗收。

## 本輪清理的驗證範圍

2026-10-26清理盤點覆蓋全部本地追蹤／待提交文件與資源；當批實際執行200項新／相關核心、6項瀏覽器流程，未重跑全套。新增[三平台CI](../.github/workflows/repository-integrity.yml)後，使用者於同日後續追查確認三平台「通過」。此為使用者提供的結果，代理未取得run ID／各平台log：API查詢Forbidden、公開頁面404。後續新增右鍵測試至矩陣的版本，仍以新一輪CI實際結果為準。GitHub API查詢wiki被403拒絕，wiki Git查詢未取得可存取倉庫，故僅能確認本地沒有wiki；未修改或假稱同步遠端wiki。
