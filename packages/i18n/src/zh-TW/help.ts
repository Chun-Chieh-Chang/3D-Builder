/**
 * help: the 說明 (docs/help-plan.md). One entry per topic, read by every way into the help (the tooltip, F1 and the help window, 這是什麼？):
 *   help.<topic>.summary   one sentence (required for every action and sketch tool: `tests/phase8/help.test.ts` fails without it)
 *   help.<topic>.body      the text: paragraphs apart by an empty line, a line starting with 「- 」 is a list item (optional)
 *   help.<topic>.title     only for a topic that is not an action or a tool (an action's title is its label, so the two never differ)
 *   help.<topic>.keywords  words to find it by besides its title and summary (optional)
 *   help.<topic>.see       the topics to look at next, apart by spaces (optional)
 * A topic is the id of an action in `apps/web/src/actions.ts` (the sketch tools are `tool-<tool>`) or `concept.<name>`.
 * What a verified item shows (docs/manual-verification.html) is written here as it was seen; when the item is corrected, correct the topic
 * (docs/help-links.json says which topics an item is about).
 */
export const help = {
  // ---------------------------------------------------------------- the window
  'helpui.title': '說明',
  'helpui.button': '說明',
  'helpui.buttonTip': '說明 (F1)：依目前在做的事開啟說明',
  'helpui.whatIsThis': '這是什麼？',
  'helpui.whatIsThisTip': '按下後，點任何按鈕或面板，會開啟它的說明（Esc 取消）',
  'helpui.pickHint': '點選要看說明的按鈕或面板；Esc 取消。',
  'helpui.search': '搜尋說明…',
  'helpui.contents': '目錄',
  'helpui.noResult': '找不到符合的說明。',
  'helpui.related': '相關主題',
  'helpui.close': '關閉',
  'helpui.back': '返回',
  'helpui.pressF1': '按 F1 看更多',
  'helpui.noBody': '這個主題還沒有詳細說明；上面是它的簡述。',
  'helpui.shortcut': '快速鍵：{key}',
  'helpui.noTopic': '沒有這個主題的說明。',
  'help.group.concept': '基本概念',

  // ---------------------------------------------------------------- concepts
  'help.conceptOverview.title': '開始使用',
  'help.conceptOverview.summary': '3D-Builder 是參數式 3D CAD：先畫草圖，再用特徵把草圖變成實體。',
  'help.conceptOverview.body':
    '典型流程：\n\n- 在設計樹點一個基準面（前、上、右），按「草圖」分頁的「草圖」進入草圖。\n- 畫圖元、標尺寸、加限制條件，按「離開草圖」。\n- 選取那張草圖，按「特徵」分頁的「伸長填料/基材」等指令，在左邊面板設定後按 ✔。\n- 之後在設計樹雙擊特徵可以改它的數值，模型會跟著重新計算。\n\n每個按鈕停留一下會顯示一句話；按 F1 開啟說明，按「這是什麼？」再點任何按鈕或面板可以看它的說明。',
  'help.conceptOverview.keywords': '入門 開始 教學 流程',
  'help.conceptOverview.see': 'sketch extrude concept.sketch-snaps concept.selection',

  'help.conceptSelection.title': '選取',
  'help.conceptSelection.summary': '在圖形區或設計樹點選面、邊、特徵；按住 Ctrl 加選。',
  'help.conceptSelection.body':
    '- 單擊選取；在設計樹，單擊只是選取，雙擊才會進入編輯。\n- 按住 Ctrl 再點，加選或取消選取。\n- 在草圖中，在空白處拖曳可以方塊選取。\n- 面板在等你選面或邊時，直接在圖形區點即可，選到的會列在面板裡。',
  'help.conceptSelection.keywords': '點選 加選 方塊選取 Ctrl',

  'help.conceptFeatureTree.title': '設計樹（FeatureManager）',
  'help.conceptFeatureTree.summary': '列出零件的特徵，由上而下是建立的順序。',
  'help.conceptFeatureTree.body':
    '- 單擊選取，雙擊編輯特徵或草圖。\n- 右鍵可以抑制、刪除、顯示或隱藏。\n- 特徵出錯時圖示會變色，點狀態列的訊息可以看原因。\n- 設計樹的順序就是重算的順序：後面的特徵用到前面的結果。',
  'help.conceptFeatureTree.keywords': 'FeatureManager 特徵樹 抑制 刪除',

  'help.conceptPropertyManager.title': '屬性面板（PropertyManager）',
  'help.conceptPropertyManager.summary': '建立或編輯特徵時，左邊出現的面板；設好後按 ✔，按 ✖ 放棄。',
  'help.conceptPropertyManager.body': '- 面板上的選取清單等你在圖形區點選。\n- 數值欄位按 Enter 確認；可以輸入運算式或方程式的變數名稱。\n- ✔ 確認並建立特徵，✖ 放棄。\n- 面板開著時，圖形區顯示的是「這個特徵之前」的模型；按 ✔ 才看得到結果（薄殼等特徵會這樣）。',
  'help.conceptPropertyManager.keywords': '面板 PropertyManager 確認',

  'help.conceptSketchSnaps.title': '草圖的吸附與推斷',
  'help.conceptSketchSnaps.summary': '畫草圖時游標會吸到附近的點、線、模型的邊，並自動加水平、垂直、共線、平行、垂直等關係。',
  'help.conceptSketchSnaps.body':
    '游標靠近時，圖形區會亮顯對象，游標旁顯示名稱，點下去就建立對應的限制條件：\n\n- 重合：吸到草圖已有的點或原點，兩點合為一點。\n- 中點、在圖元上：吸到直線的中點，或線、圓、弧上的任一處。\n- 水平點、垂直點：游標和另一個草圖點（端點、圓心、原點）水平或垂直對齊（5 像素內）時，畫一條灰色虛線連到那個點，並加水平或垂直關係；同時對齊兩個點時吸到交叉點。\n- 水平、垂直：畫直線時與起點接近水平或垂直（3° 內）。\n- 共線、平行、互相垂直：畫直線時方向與另一條線接近（3° 內）：起點在那條線上是共線（畫出灰色虛線延伸），否則是平行；差一個直角是互相垂直；那條線會亮顯。\n- 相切：從圓弧端點沿切線方向畫直線；或游標接近「從起點到圓或圓弧的切點」時吸到切點，並加相切關係。\n- 垂直（垂足）：畫直線時游標接近「起點到另一條直線的垂足」時吸到垂足，新線與那條線互相垂直、終點在那條線上。\n- 交點：游標接近兩個圖元的交叉處，新的點成為兩者的交點。\n- 四分之一點：圓或圓弧上 0°、90°、180°、270° 的位置；新的點在圖元上，並與圓心水平或垂直。\n- 網格與角度（預設不啟用）：在「系統選項」打開網格後，自由的點抓到網格點；打開角度後，直線的方向抓到角度間隔的倍數（3° 內）；畫線時按住 Shift，長度抓到網格間距的倍數。\n- 模型端點、模型中點、模型圓心、在模型邊上：在模型的面上畫草圖時，吸到那個面的邊；點下去，這條邊會成為跟著模型走的圖元（紫色），新的點和它重合，模型改了草圖跟著動。\n\n優先順序：草圖自己的點與中點最優先，其次是模型的端點、圓心、中點，交點，四分之一點，相切與垂足，再來是草圖圖元上的位置，然後是模型邊上的位置，最後才是水平、垂直、共線等推斷。\n\n「系統選項」的「草圖抓取」可以整個關掉（關掉時沒有吸附，也不會自動加關係），或只關其中幾種。在畫圖的工具中按右鍵 →「快速抓取」可以只留一種抓取，其他暫時關掉，換工具或取消時結束。\n\n自動加的關係之後可能讓你手動加的關係變成「多餘」；可以在草圖左邊面板的限制條件清單刪掉它。',
  'help.conceptSketchSnaps.keywords': '吸附 推斷 抓取 虛線 水平點 垂直點 共線 平行 模型邊 磁吸',
  'help.conceptSketchSnaps.see': 'sketch tool-line tool-convert',

  'help.conceptDrawingDimensions.title': '工程圖的尺寸',
  'help.conceptDrawingDimensions.summary': '在工程圖的視圖上標註線性、直徑、半徑與角度尺寸，數字永遠來自模型。',
  'help.conceptDrawingDimensions.body':
    '在工程圖面板選一個視圖，「尺寸」區可以一次產生全部（外形尺寸、孔、孔的位置），或自己選：\n\n- 線性：兩個平面或圓（側視成線或圓）之間的水平、垂直或對齊距離。\n- 直徑與半徑：選一個圓或孔，可寫成「4×Ø9」，孔可加上貫穿或深度的註記。\n- 角度：選兩個側視成一條線的平面（與視圖的 x 或 y 垂直的，或斜面）；弧畫在兩條線相交處，半徑可以改（弧半徑），「用另一個夾角」換成補角。角度是兩個面「從相交處往各自面的中間」伸出去的兩條射線所夾的角，例如方塊頂面與 45° 的導角面夾 135°（勾補角是 45°）。兩個面互相平行時沒有夾角，會說明。\n\n- 每個尺寸可以加公差（上下限；直徑與線性也可以用 ISO 286 的配合）、設成參考尺寸（括號）。\n- 尺寸的數字每次都從模型算出，模型改了尺寸就跟著變；元素不見了會說明原因。',
  'help.conceptDrawingDimensions.keywords': '尺寸 角度 直徑 半徑 公差 工程圖 標註',

  // ---------------------------------------------------------------- file
  'help.newPart.summary': '開始一個空白零件，附前、上、右三個預設基準面。',

  'help.newPart.body':
    '開始一個空白零件。\n\n- 目前的零件有未存的修改時，會先問要不要儲存。\n- 新零件的設計樹只有「原點」和前、上、右三個基準面，3D 視窗是空的。\n- 新零件的材質等設定取自系統選項的「新零件使用的範本」（預設空白）；要指定範本時用「新零件（範本）…」。\n- 接下來：選一個基準面，按「草圖」畫輪廓，再用「伸長填料/基材」長出形狀。',

  'help.newPart.keywords': '新零件 空白零件 基準面',

  'help.newPart.see': 'new-part-template sketch extrude',
  'help.newPartTemplate.summary': '從範本開始新零件，範本先選好材質與文件設定（空白、碳鋼、鋁件、塑膠件、CNS 製圖）。',

  'help.newPartTemplate.body':
    '從範本開始新零件：選一個範本，新零件的材質與文件設定就先設好。\n\n- 空白：沒有材質。\n- 碳鋼、鋁件（材質是鋁合金 6061）、塑膠件（材質是 ABS）、CNS 製圖（碳鋼，製圖標準 CNS，小數 2 位）。\n- 要讓「新零件」一律用某個範本，在「系統選項」的「新零件使用的範本」選。\n- 沒有自訂範本的功能。',

  'help.newPartTemplate.keywords': '範本 新零件 材質 鋁件 塑膠件 CNS',

  'help.newPartTemplate.see': 'new-part options properties',
  'help.newAssembly.summary': '開始一個空白組合件，之後插入零組件並加結合。',

  'help.newAssembly.body':
    '開始一個空白組合件（.3dba）：把好幾個零件「組」在一起。\n\n- 第一次要「選擇專案資料夾」：組合件用相對路徑找零件，所以要告訴程式零件放在哪個資料夾；瀏覽器問能不能存取時按「允許」。\n- 左邊出現「開始組合件」面板，「要插入的零件」清單列出專案資料夾裡的零件（.3dbx）與組合件（.3dba，標「3DBA」）。點一個、等它載入完（面板顯示進度），按 ✔ 放在原點。\n- 第一個零組件自動固定在原點；之後用「插入零組件」加入其他的，再用「結合」定位。',

  'help.newAssembly.keywords': '新組合件 組合件 專案資料夾 零組件',

  'help.newAssembly.see': 'insert-component mate fix-component',
  'help.newDemo.summary': '開啟一個示範零件，用來看各種特徵的樣子。',

  'help.newDemo.body':
    '開啟一個示範零件：20 × 10 × 5 mm 的方塊，一邊有圓角。\n\n- 設計樹有「草圖1」「伸長1」「圓角1」，最下方的體積是 991.416 mm³。\n- 用來看各種特徵的樣子，或做驗證手冊的步驟，不用自己畫。\n- 它是一個新的未存檔零件，可以隨意修改。',

  'help.newDemo.keywords': '示範件 示範零件 範例 方塊 圓角',

  'help.newDemo.see': 'new-part sketch fillet',
  'help.open.summary': '開啟零件（.3dbx）或組合件（.3dba）檔案。',

  'help.open.body':
    '開啟零件（.3dbx）或組合件（.3dba）檔案。\n\n- 跳出瀏覽器自己的「開啟檔案」視窗；找到檔案按「開啟」。瀏覽器問能不能存取時按「允許」；目前的檔案有未存的修改時會先問要不要儲存。\n- 開啟組合件時，第一次要選「專案資料夾」（就是那個 .3dba 所在的資料夾），因為組合件用相對路徑找零件。\n- 零件載入時，最下方顯示進度。\n- 當機或不小心關掉分頁後再開，程式會問是否復原沒存的零件。',

  'help.open.keywords': '開啟舊檔 開啟 檔案 專案資料夾',

  'help.open.see': 'save save-as new-assembly',
  'help.save.summary': '儲存目前的檔案；還沒有檔名時會問存在哪裡。',

  'help.save.body':
    '儲存目前的檔案；還沒有檔名時會問存在哪裡。\n\n- 分頁標題與檔名後面的「*」表示有尚未儲存的修改。\n- 存檔後最下方出現「已儲存 …」。\n- 另外有自動存檔：最後一次變更幾秒後（系統選項可改，預設 5 秒）存一份暫存，當機或關掉分頁後重開，會出現「找到沒有儲存的零件」，可以「復原」或「捨棄」；復原回來的零件還沒存檔，要再「另存新檔」。',

  'help.save.keywords': '儲存 存檔 自動存檔 復原',

  'help.save.see': 'save-as open options',
  'help.saveAs.summary': '用新的檔名或位置儲存；組合件另存時會改寫零件的相對路徑。',

  'help.saveAs.body':
    '用新的檔名或位置儲存。\n\n- 組合件另存到別的資料夾時，零件的相對路徑會改寫，復原記錄也跟著改。\n- 工程圖要存在專案資料夾之內，存到外面時會說「工程圖必須存在專案資料夾…之內」。\n- 還沒存過的零件（新零件、復原回來的零件）第一次存檔也用這個。',

  'help.saveAs.keywords': '另存新檔 另存 檔名 位置',

  'help.saveAs.see': 'save open new-drawing',
  'help.exportStep.summary': '把零件或組合件輸出成 STEP 檔，可以給別的 CAD 開啟。',

  'help.exportStep.body':
    '把零件或組合件輸出成 STEP 檔，可以給別的 CAD 開啟。\n\n- 零件：跳出視窗，選「格式」（例如 AP242），勾「帶著顏色」，選「座標系統」（預設「零件原點」，也可以選自己做的座標系統，檔案的原點與軸向就取自它），按「輸出」。\n- 瀏覽器下載一個 .step 檔，最下方出現「已輸出 …」。\n- 組合件：輸出的階層是零組件，位置是組裝的位置（不是爆炸後的位置），次組合件是一層，面的顏色也帶出去。\n- 曲面本體當殼輸出；偏移曲面轉成 B 樣條，別的 CAD 讀不讀得進沒有試過。\n- 用 eDrawings 或別的 CAD 開來看形狀與顏色對不對。',

  'help.exportStep.keywords': '輸出 STEP 檔案 匯出 座標系統 顏色 AP242',

  'help.exportStep.see': 'import-step coord-sys export-stl',
  'help.exportStl.summary': '把零件的實體輸出成 STL（三角網格）檔，精細度依文件的網格品質設定。',

  'help.exportStl.body':
    '把零件的實體輸出成 STL（三角網格）檔，用於 3D 列印與切片軟體。\n\n- 精細度依文件的「顯示與輸出品質」（在「檔案屬性」設，細或粗）：粗的圓柱看得出多邊形的稜。\n- 瀏覽器下載一個 .stl 檔。',

  'help.exportStl.keywords': '輸出 STL 三角網格 列印 精細度',

  'help.exportStl.see': 'export-step properties export-image',
  'help.exportImage.summary': '把圖形區現在看到的畫面存成 PNG 圖片。',

  'help.exportImage.body':
    '把圖形區現在看到的畫面存成 PNG 圖片。\n\n- 視角、顯示類型與剖面都照現在的樣子。\n- 瀏覽器下載一個 .png 檔，用看圖程式開。',

  'help.exportImage.keywords': '輸出影像 圖片 PNG 截圖',

  'help.exportImage.see': 'export-stl view-iso',
  'help.newDrawing.summary': '為已儲存的零件或組合件建立工程圖（檔案有未儲存的修改時不能用）。',

  'help.newDrawing.body':
    '為已儲存的零件或組合件建立工程圖（零件有未存的修改時這個指令是灰的）。\n\n- 第一次要選「專案資料夾」（放著零件檔的資料夾）；工程圖也要存在這個資料夾之內（.3dbd）。\n- 畫面變成工程圖：A3 橫向的圖頁，前視、上視、右視三個視圖（第一角投影），右下有標題圖塊（圖名取自零件名）。\n- 圖頁區：大小（A4、A3…）、方向、比例（可「最適比例」）、投影法（第一角或第三角）；視圖始終在圖頁內。\n- 視圖：可勾「顯示隱藏線」；拖曳視圖移動位置（會記住），「自動排版」回到自動排好的位置。\n- 標題圖塊逐欄填：公司、圖名、圖號、材質、繪製、日期、版次、通則公差、比例、投影法。\n- 可以加投影視圖、剖面視圖、細部放大圖，標註尺寸（見「工程圖的尺寸」）。\n- 工程圖從專案資料夾讀取零件檔：零件改了、存檔，重新開啟工程圖就跟著變；模型的參考不見了，尺寸會寫「找不到尺寸指的元素」。',

  'help.newDrawing.keywords': '工程圖 圖頁 視圖 標題圖塊 三視圖 第一角 第三角',

  'help.newDrawing.see': 'concept.drawing-dimensions save-as export-step',
  'help.generateAssembly.summary': '為零件的每個本體各寫一個衍生零件檔，再產生用它們組成的組合件（要先儲存零件）。',

  'help.generateAssembly.body':
    '為零件的每個本體各寫一個衍生零件檔，再產生用它們組成的組合件；用來把多本體的零件（例如夾具主模型）拆成零件並自動排好。\n\n- 零件要先儲存。\n- 衍生零件只存來源（主模型）與本體編號，面的名稱沿用主模型；主模型改了，重新產生就跟著變（不即時更新）。\n- 零件表排除參考零件；主模型的一個本體就是組合件的一個零組件。\n- 限制：不即時更新，跨零件不共用主模型的重算。',

  'help.generateAssembly.keywords': '產生組合件 衍生零件 本體 夾具 主模型',

  'help.generateAssembly.see': 'new-assembly insert-component bom',
  'help.importStepAssembly.summary': '把 STEP 組合件讀進來，拆成零件檔與組合件。',

  'help.importStepAssembly.body':
    '把 STEP 組合件讀進來，保留結構：每個零件一個 .3dbx、每個次組合件一個 .3dba。\n\n- 選 STEP 檔後，程式說有幾個零件、幾個次組合件，要你選一個資料夾放轉出來的檔案（每次都要選，是寫入模式）；瀏覽器問時按「允許」。\n- 資料夾裡有零件檔，有次組合件時還有「組件」資料夾；位置與面的顏色保留。\n- 零組件名稱是「檔名＋編號」，不沿用 STEP 裡的名稱。\n- 只有 AP203 把組合件併成單一實體的檔案，讀進來只有一個零件。',

  'help.importStepAssembly.keywords': '輸入 STEP 組合件 匯入 結構 零件 次組合件 顏色',

  'help.importStepAssembly.see': 'import-step export-step new-assembly',
  'help.returnAssembly.summary': '從編輯中的零件回到開啟它的組合件。',

  'help.returnAssembly.body':
    '從編輯中的零件回到開啟它的組合件。\n\n- 在組合件裡開啟某個零件修改時，這個鈕才有作用。\n- 零件改過、存檔後，回到組合件會更新那個零組件。\n- 零件的修改要先存檔，組合件才讀得到。',

  'help.returnAssembly.keywords': '返回組合件 開啟零件 編輯零件',

  'help.returnAssembly.see': 'open insert-component new-assembly',

  // ---------------------------------------------------------------- tools
  'help.equations.summary': '定義全域變數與運算式，尺寸和特徵數值可以引用它們。',

  'help.equations.body':
    '定義全域變數與運算式，尺寸和特徵數值可以引用它們。要先離開草圖才能按（編輯草圖時是灰色的）。\n\n- 「全域變數」：在最下面一列輸入名稱與運算式（例如 w 與 30），按「新增」；之後尺寸可以寫 w*2。改變數的運算式，用到它的尺寸立刻跟著變。\n- 「草圖尺寸」表：列出每張草圖的尺寸，可以直接把數字改成運算式。\n- 運算式寫錯（例如 w*）時，那一格標成無效，最下方說「運算式不完整」，模型維持上一次的大小。\n- 循環引用（b 用 a、a 用 b）會被擋下，並說出轉一圈的路徑（循環引用：b → a → b）。\n- 變數改名時，用到它的運算式自動改成新名字。\n- 特徵面板的數字格也可以寫運算式（例如深度 h/2，格子旁顯示「= 7.5 mm」）；也可以用檔案屬性：property(\'板厚\')。\n- 草圖上由運算式算出來的尺寸顯示成 Σ60 的樣子。',

  'help.equations.keywords': '方程式 全域變數 運算式 參數 尺寸 引用',

  'help.equations.see': 'properties sketch concept.property-manager',
  'help.appearance.summary': '為零件、本體、特徵或面指定顏色；優先順序是面 ＞ 特徵 ＞ 本體 ＞ 零件。',

  'help.appearance.body':
    '為零件、本體、特徵或面指定顏色。先在圖面點一個面（或在設計樹選一個東西），再按這個指令。\n\n- 「上色的對象」：整個零件、本體、特徵或面；按「顏色」旁的色塊挑顏色，按「套用」；「已上色的」清單列出設定過的，「移除顏色」取消。\n- 優先順序：面 ＞ 特徵 ＞ 本體 ＞ 零件；圖案與鏡射做出來的面也帶同一個特徵的顏色。\n- 輸出 STEP 時勾「帶著顏色」就會帶出去。',

  'help.appearance.keywords': '外觀 顏色 上色 面 特徵 本體',

  'help.appearance.see': 'export-step properties',
  'help.options.summary': '系統選項：介面語言、自動存檔、「新零件」用的範本、開始時可點選的元素；存在這個瀏覽器，不屬於零件檔。',

  'help.options.body':
    '系統選項：介面語言、自動存檔、新零件的範本、開始時可點選的元素、草圖抓取。這些存在這個瀏覽器，不屬於零件檔。\n\n- 介面語言：繁體中文或 English，選了立刻生效（組合件的畫面與示範件的內容還有部分中文）。\n- 自動存檔：開或關，與「最後一次變更後幾秒存檔」（預設 5 秒）。\n- 「新零件」使用的範本：空白、碳鋼、鋁件、塑膠件、CNS 製圖。\n- 開始時可以點選的元素：面、邊線、頂點（取消勾的，「選擇濾器」一開始就是取消的）。\n- 草圖抓取：總開關與各項（端點、中點、圖元上的最近點、四分之一點、交點、相切、垂足、水平點與垂直點、模型的邊與頂點、網格、角度），網格間距與角度間隔；網格與角度預設不啟用。見「草圖的吸附與推斷」。',

  'help.options.keywords': '系統選項 語言 自動存檔 範本 選取 草圖抓取 設定',

  'help.options.see': 'concept.sketch-snaps new-part-template save',
  'help.shortcuts.summary': '查看與自訂每個指令的快速鍵。',

  'help.shortcuts.body':
    '查看與自訂每個指令的快速鍵。\n\n- 點指令右邊的格子，按下想用的組合鍵（例如 Ctrl+Shift+E），按「關閉」；之後按那個組合鍵就執行那個指令。\n- 「還原預設」把全部改回預設。\n- 復原是 Ctrl+Z，重做是 Ctrl+Y；F1 開說明。',

  'help.shortcuts.keywords': '快速鍵 快捷鍵 熱鍵 自訂',

  'help.shortcuts.see': 'undo redo concept.overview',
  'help.measurePart.summary': '量測零件上選取的點、邊、面之間的距離與角度；再按一次結束。',

  'help.measurePart.body':
    '量測零件上選取的點、邊、面之間的距離與角度；再按一次或按「結束」結束。\n\n- 在 3D 視窗點元素；再點一下別的元素就重新開始，同一個元素再點一次取消它。\n- 一個元素：面是面積，邊是長度，圓是半徑與直徑，頂點是座標。兩個元素：最短距離（接觸時是 0），兩個頂點還有 ΔX、ΔY、ΔZ；夾角是銳角（0 到 90 度）。\n- 數字的單位是 mm 與度。',

  'help.measurePart.keywords': '量測 測量 距離 夾角 面積 半徑 座標',

  'help.measurePart.see': 'measure-assembly physical-part check-part',
  'help.draftAnalysis.summary': '分析各面相對脫模方向的拔模角，並在圖形區上色。',

  'help.draftAnalysis.body':
    '分析各面相對脫模方向的拔模角，並在圖形區上色，看塑膠件有沒有足夠的脫模斜度。\n\n- 視窗設定：「拔模方向（模具打開的方向）」（預設 +Z，所以外殼要用前基準面做、開口朝向你）、「要求的拔模角（度）」、「反轉方向」、「用選取的平面的法向」（先在圖面點一個平面）。\n- 角度的定義：面的法向與方向的夾角減 90°，正值表示沿這個方向脫得出來。\n- 結果表分類：正拔模、負拔模、需要拔模（角度小於要求的）、跨越、無法取樣，各有面數與面積；「各個面」清單列最小到最大角度。\n- 「反轉方向」讓類別互換。「關閉」取消顏色。與「底切分析」塗同一批面，一次只開一個。\n\n驗證過的例子：60 × 40 × 30、壁 2、頂面開口的直壁外殼，方向 +Z：正拔模 2 個面（2400 mm²）、負拔模 1 個面（2400）、需要拔模 8 個面（11152 mm²）、跨越 0 個。',

  'help.draftAnalysis.keywords': '拔模分析 脫模 拔模角 模具 塑膠 方向',

  'help.draftAnalysis.see': 'undercut-analysis draft thickness-analysis',
  'help.undercutAnalysis.summary': '找出沿脫模方向兩端都被擋住的面（底切）。',

  'help.undercutAnalysis.body':
    '找出沿脫模方向兩端都被擋住的面（底切），這些面模具打不開，要側向抽芯。\n\n- 視窗設定：方向（預設沿開口方向）；結果表列出底切的面數與面積；「各個面」列出每面「上方／下方／都看不到」的比例。\n- 結果分類：底切（要側向抽芯）、只從上方看得到、只從下方看得到、上下都看得到（沿方向的牆，要拔模）。\n- 把方向改成孔的方向，孔壁就不再是底切。沒有底切的零件，底切面積顯示 0。\n- 視窗寫三角形數、取樣點數與用了幾毫秒。\n- 與「拔模分析」塗同一批面，一次只開一個；開另一個時，方向沿用。\n\n驗證過的例子：外殼（60 × 40 × 30、壁 2）加一個橫向貫穿的孔：孔壁 753.98 mm² 是唯一的底切；沒有孔的殼：底切 0 個面，只從上方看得到 6 個面（7552 mm²）、只從下方 1 個、上下都看得到 4 個。',

  'help.undercutAnalysis.keywords': '底切分析 底切 側向抽芯 模具 方向',

  'help.undercutAnalysis.see': 'draft-analysis thickness-analysis shell',
  'help.thicknessAnalysis.summary': '沿內法向量測各面的壁厚，標出最薄與最厚的地方。',

  'help.thicknessAnalysis.body':
    '沿內法向量測各面的壁厚，標出太薄與太厚的地方。\n\n- 視窗設定：「最小壁厚（mm，空白＝不限）」與「最大壁厚」，填完自動重算；兩格要是大於 0 的數字，而且最小不能大於最大，否則標成無效並說明。\n- 結果表分類：符合（綠）、太薄（紅）、太厚（藍）、對面沒有面可量、無法取樣；另列「最薄的地方」「最厚的地方」與「各個面（最小／中位數／最大 mm）」。\n- 厚度是沿內法向到對面的距離；開口那圈邊緣面量到的是整面牆的高度，所以會算成太厚（它的距離不是壁厚）。\n- SolidWorks 的厚度定義可能不同，與它對照時請記下差多少。\n\n驗證過的例子：60 × 40 × 30、壁 2 的外殼，最小壁厚 1、最大 4：10 個面符合、開口那圈邊緣面太厚、最薄的地方是 2 mm；最小壁厚改成 3，十個面變成太薄。',

  'help.thicknessAnalysis.keywords': '厚度分析 壁厚 太薄 太厚 塑膠 量測',

  'help.thicknessAnalysis.see': 'draft-analysis undercut-analysis shell',
  'help.checkPart.summary': '檢查模型幾何：是否通過有效性檢查、外殼是否封閉（有沒有開放邊）、體積是否為正。',

  'help.checkPart.body':
    '檢查零件的模型幾何：實體數、面數、有問題的面、開放邊與體積。\n\n- 「有問題」是指：OCCT 的有效性檢查沒通過、外殼沒有封閉（有只屬於一個面的開放邊），或體積為零或負數。\n- 匯入的 STEP 與修復過的模型最需要檢查；有問題的面編號會列出來。\n- 一個正常的零件，下方寫「共 1 個零件，全部正常」。',

  'help.checkPart.keywords': '檢查幾何 有效性 開放邊 外殼 體積',

  'help.checkPart.see': 'check-assembly import-step physical-part',
  'help.physicalPart.summary': '設定材質並計算質量、重心與慣性矩。',

  'help.physicalPart.body':
    '設定材質並計算零件的質量、體積、表面積、質心與慣性矩。\n\n- 先在「工具」→「檔案屬性」選材質（碳鋼、鑄鐵、不鏽鋼 304、鋁合金 6061 與 7075、銅、黃銅、鈦合金、ABS、PC、尼龍 PA6、POM、PP、壓克力）或選「自訂…」輸入密度（g/cm³）。質量 ＝ 體積 × 密度，不含參考本體。\n- 視窗列出質量、體積、表面積、質心、慣性矩（對質心，座標軸方向）、主慣性矩（由小到大）與方向。\n- 單位：質量 g、體積 mm³、表面積 mm²、質心 mm、慣性矩 g·mm²。\n- 內建材質的密度是常用牌號的整數值，其他牌號請用「自訂」。\n\n手算的例子：40 × 30 × 10 的方塊體積 12000 mm³，碳鋼（7.85 g/cm³）質量 94.20 g。',

  'help.physicalPart.keywords': '物質特性 質量 材質 密度 質心 慣性矩',

  'help.physicalPart.see': 'properties physical-assembly check-part',
  'help.properties.summary': '編輯檔案屬性（料號、廠商、說明等），零件表會讀它。',

  'help.properties.body':
    '編輯檔案屬性：材質、顯示與輸出品質、自訂屬性（料號、廠商、說明等）。編輯草圖時這個指令是灰的，要先離開草圖。\n\n- 材質：下拉選（碳鋼、鑄鐵、不鏽鋼 304、鋁合金 6061 與 7075、銅、黃銅、鈦合金、ABS、PC、尼龍 PA6、POM、PP、壓克力）或「自訂…」輸入密度（g/cm³）；選了之後視窗顯示「質量：… g」，狀態列也多一個質量（質量 ＝ 體積 × 密度）。\n- 顯示與輸出品質：細或粗，影響網格的精細度（顯示與 STL）。\n- 自訂屬性：在最下面一列輸入屬性名稱與值（例如 板厚 與 4mm），按「新增」。尺寸與特徵數值可以用 property(\'板厚\') 引用；零件表讀「廠商」「料號」。\n\n手算的例子：8000 mm³ 的方塊，碳鋼（7.85 g/cm³）質量 62.80 g。',

  'help.properties.keywords': '檔案屬性 屬性 材質 料號 廠商 品質 自訂',

  'help.properties.see': 'equations physical-part bom',

  // ---------------------------------------------------------------- features
  'help.sketch.summary': '在選取的基準面或平面上建立並進入草圖。',
  'help.sketch.body':
    '先在設計樹點一個基準面（或在圖形區點一個平面），再按「草圖」。進入草圖後：\n\n- 左邊面板顯示「草圖狀態」：完全定義、定義不足（尚有 N 個自由度）或過多定義。藍色圖元是定義不足，黑色是完全定義，紅色是衝突。\n- 用「草圖」分頁的工具畫圖元，用「智慧型尺寸」標尺寸，選取圖元後在面板加限制條件。\n- 編輯草圖時，方程式與檔案屬性按鈕是灰的；離開草圖後在方程式視窗的「草圖尺寸」表可以改尺寸。\n- 要用草圖做特徵時，草圖輪廓要封閉；面板的「檢查草圖用於特徵」會列出開放端點，調大「間隙容差」可以一鍵修復。',
  'help.sketch.keywords': '草圖 進入草圖 完全定義 定義不足 過多定義 開放端點 間隙容差',
  'help.sketch.see': 'exit-sketch tool-dimension concept.sketch-snaps extrude',

  'help.extrude.summary': '把選取的草圖沿垂直方向拉出厚度，加到零件上。',
  'help.extrude.body':
    '先選一張草圖再按這個指令。面板的設定：\n\n- 終止型態：給定深度、兩側對稱、完全貫穿、成形至某一面、成形到下一面、成形至頂點、成形至本體、從曲面偏移。\n- 反轉方向、拔模（可勾「往內拔模」）、方向 2（另一邊也拉）、薄件（只長出一圈厚度；可選向內、兩側對稱或雙向不同厚度）。\n- 草圖有多個封閉區域時，「所選輪廓」清單可以只選其中幾個（至少留一個）。\n- 合併結果：勾選時與接觸的本體合併，否則成為新的本體。\n\n驗證過的例子：20 × 10 的矩形、深度 10 是 2000 mm³；加 3° 外拔模約 2160.89；方向 2 深度 4 是 2800；薄件厚度 2 向內是 1040。',
  'help.extrude.keywords': '伸長 拉伸 填料 基材 終止型態 薄件 拔模 方向 2 貫穿 下一面 頂點 本體 偏移',
  'help.extrude.see': 'extrude-cut sketch concept.property-manager',

  'help.revolve.summary': '把草圖繞一條中心線旋轉，加到零件上。',

  'help.revolve.body':
    '先選一張草圖再按這個指令。草圖要有一條直線當旋轉軸（通常是中心線），輪廓畫在軸的一側。\n\n- 旋轉軸：下拉選單列出草圖裡的直線（中心線與一般直線）。\n- 旋轉類型：給定角度（從草圖面往一個方向轉）或兩側對稱（角度分到兩邊）；「反轉方向」換轉的方向。\n- 角度預設 360°；小於 360° 得到一段。\n- 薄件、「所選輪廓」、「合併結果」與伸長相同。\n- 輪廓沒有封閉時，特徵會出錯並說明（沒有可旋轉的封閉輪廓）。\n\n手算的例子：10 寬 × 20 高的矩形，一邊貼在旋轉軸上，轉 360° 是半徑 10、高 20 的圓柱：π × 10² × 20 = 6283.19 mm³；轉 90° 是它的四分之一，1570.80 mm³。',

  'help.revolve.keywords': '旋轉 旋轉填料 基材 中心線 軸 角度 車削',

  'help.revolve.see': 'revolve-cut sketch extrude concept.property-manager',
  'help.sweep.summary': '把一張輪廓草圖沿另一張草圖畫的路徑掃出，加到零件上。',

  'help.sweep.body':
    '先畫兩張草圖：輪廓（一個封閉輪廓）與路徑（一條連在一起的開放線或圓弧，一端要在輪廓的平面上）。選輪廓草圖再按這個指令，在面板選路徑草圖。\n\n- 掃出從路徑落在輪廓平面上的那一端開始，輪廓與路徑的夾角維持不變。\n- 輪廓有洞時，結果是外輪廓掃出減去洞掃出（管子就是兩個同心圓）。\n- 「所選輪廓」與「合併結果」的用法與伸長相同。\n- 封閉的路徑不能用（結果的體積算成 0），會說明原因；結果不是有效實體時也會說明。\n\n手算的例子：輪廓 4 × 6、直線路徑長 40：24 × 40 = 960 mm³；路徑是長 30 的線、R10 的四分之一圓弧、再往上長 20 的線，輪廓放在路徑上：24 × (30 + 15.708 + 20) = 1577.0 mm³（輪廓面積乘以路徑長度）。',

  'help.sweep.keywords': '掃出 掃描 輪廓 路徑 管 彎管 Pappus',

  'help.sweep.see': 'sweep-cut sketch loft',
  'help.loft.summary': '在兩張以上的輪廓草圖之間做出漸變的形狀，加到零件上。',

  'help.loft.body':
    '先在幾個平面上各畫一張截面草圖（每張一個封閉輪廓、不能有洞），選第一張再按這個指令，用「加入截面…」依序加入其他的。\n\n- 截面清單由第一個到最後一個，可以用「上移」「下移」「移除」調整順序。\n- 面順著所有截面平滑通過；只有兩個截面時是直紋。\n- 起點在哪一個角、繞哪一個方向都不必對齊，由核心配對。\n- 截面的邊數可以不同（方形接圓形也行）。\n- 結果不是有效實體時特徵出錯並說明。\n\n手算的例子：兩個 10 × 6 的矩形相距 20 是柱 1200 mm³；20 × 20 接 10 × 10、相距 20 是角錐台 (20/3) × (400 + 200 + 100) = 4666.67 mm³；半徑 5 的圓接半徑 2 的圓、相距 20 是圓錐台 π × 20/3 × (25 + 10 + 4) = 816.81 mm³。',

  'help.loft.keywords': '疊層拉伸 放樣 截面 漸變 錐台',

  'help.loft.see': 'loft-cut sweep sketch',
  'help.rib.summary': '用草圖畫的肋線，長出指定厚度的加強肋，可選在線的中間或某一側。',

  'help.rib.body':
    '在草圖裡畫一條直線，選這張草圖再按這個指令：線加上厚度成為一道牆，從線在草圖面內垂直於線的方向長出去，碰到本體為止，並與本體接成一體。\n\n- 肋材厚度；「厚度的位置」：兩側（以草圖面為中心）、草圖法向的一側、或另一側。\n- 「反轉方向」換牆長出去的方向。程式不自動選方向：長不到本體時會說明要反轉。\n- 草圖要放在垂直於板面的平面上，線的位置就是肋的頂邊。\n\n手算的例子：40 × 40 × 10 的板，線在板上方 15 的位置、長 20、厚度 4：16000 + 15 × 20 × 4 = 17200 mm³。',

  'help.rib.keywords': '肋材 加強肋 筋 厚度 反轉',

  'help.rib.see': 'extrude sketch concept.property-manager',
  'help.extrudeCut.summary': '把選取的草圖沿垂直方向拉出，從零件上切除。',

  'help.extrudeCut.body':
    '先選一張草圖再按這個指令；做法與「伸長填料／基材」相同，只是把拉出來的形狀從零件上除掉。\n\n- 除料預設往材料內部（與草圖法向相反）；勾「反轉方向」改往另一邊。\n- 終止型態、拔模、方向 2、薄件、「所選輪廓」的用法與伸長相同。\n- 完全貫穿會一路切穿；給定深度只切到那個深度。\n\n手算的例子：40 × 30 × 10 的方塊，在頂面草圖畫 10 × 10 的正方形、給定深度 4：12000 − 400 = 11600 mm³；完全貫穿：12000 − 1000 = 11000 mm³。',

  'help.extrudeCut.keywords': '除料 切除 伸長除料 貫穿 深度 孔 槽',

  'help.extrudeCut.see': 'extrude sketch hole concept.property-manager',
  'help.revolveCut.summary': '把草圖繞一條中心線旋轉，從零件上切除。',

  'help.revolveCut.body':
    '先選一張草圖再按這個指令；做法與「旋轉填料／基材」相同，只是把旋轉出來的形狀從零件上除掉，用來車出槽、錐孔、肩部。\n\n- 旋轉軸、旋轉類型、角度與反轉方向的用法同旋轉填料。\n- 旋轉出來的形狀要碰到零件才切得到東西。\n\n手算的例子：半徑 10、高 20 的圓柱（6283.19 mm³），草圖畫一個貼著旋轉軸、5 寬 × 20 高的矩形，轉 360° 切除，剩下內徑 5 的管：π × (10² − 5²) × 20 = 4712.39 mm³。',

  'help.revolveCut.keywords': '旋轉除料 切除 槽 車削 錐孔',

  'help.revolveCut.see': 'revolve extrude-cut sketch concept.property-manager',
  'help.sweepCut.summary': '把輪廓沿路徑掃出，從零件上切除。',

  'help.sweepCut.body':
    '做法與「掃出」相同（一張輪廓草圖、一張路徑草圖），只是把掃出的形狀從零件上除掉，用來切彎曲的槽或孔。\n\n- 路徑的一端要在輪廓的平面上，從那一端開始掃。\n- 掃出的形狀要碰到零件才切得到東西。\n- 有洞的輪廓：外輪廓掃出的形狀減去洞掃出的形狀，才是被除掉的部分。',

  'help.sweepCut.keywords': '掃出除料 切除 路徑 彎曲 槽',

  'help.sweepCut.see': 'sweep loft-cut extrude-cut',
  'help.loftCut.summary': '在兩張以上的輪廓之間做出漸變的形狀，從零件上切除。',

  'help.loftCut.body':
    '做法與「疊層拉伸」相同（依序加入截面草圖），只是把形狀從零件上除掉。\n\n- 每個截面一張草圖的一個封閉輪廓、不能有洞；截面清單可以調整順序。\n- 疊出來的形狀要碰到零件才切得到東西。',

  'help.loftCut.keywords': '疊層拉伸除料 放樣除料 切除 截面',

  'help.loftCut.see': 'loft sweep-cut extrude-cut',
  'help.fillet.summary': '把選取的邊或面（面的所有邊）倒成圓角。',
  'help.fillet.body':
    '在圖形區點要倒圓角的邊線或面（可連續點多個），在面板輸入半徑，按 ✔。點已選的會取消它。\n\n- 選邊線：只倒那一條邊（與它相切連續的邊一起）。\n- 選面：倒那個面的所有邊線，包括孔的邊；相切連續的邊與圓柱的接縫不處理。面之後多出來的邊（例如在那個面上又切了一個槽）也會倒，因為每次重新計算都是由面算出它的邊。\n- 兩者可以一起用，同一條邊只倒一次。\n- 選的面沒有任何可以倒的邊時，特徵出錯並說明原因。\n\n「圓角種類」選「面圓角」：不選邊線，改選兩組面（面組 1 與面組 2，先點選要放進的那一組，再在圖面點面）；兩組面相接的邊倒圓角，凸邊去料、凹邊（例如 L 形的內角）補料。兩組面沒有共同的邊時，特徵出錯並說明（不相鄰的面之間的圓角還沒做）。\n\n「完整圓角」：選兩個邊側面組與一個中央面（先點選要放進的那一組，再在圖面點面）；中央面被與兩側面相切的半圓柱面取代，半徑是兩個側面距離的一半，不用輸入。兩個側面要互相平行並垂直於中央面，中央面要是長方形，側面不能比半徑矮；不符合時特徵出錯並說明。新的圓柱面沿用中央面的名稱。\n\n驗證過的例子：40 × 30 × 12 的方塊，選頂面、半徑 2：14282.89 mm³（與選頂面的 4 條邊相同，頂點是斜接）；選頂面與底面：14165.78；圓柱頂面半徑 1.5 的圓角與手算相同；面圓角：頂面與一個側面（長 30 的邊）半徑 2 是 14374.25，L 形內角半徑 3 補上 77.26；完整圓角：40 × 30 × 20 的方塊，頂面夾在前後兩面之間：20137.17 mm³（半徑 15）。',
  'help.chamfer.summary': '把選取的邊或面（面的所有邊）倒成斜角。',
  'help.chamfer.body':
    '選要導角的邊線或面，選「角度-距離」或「距離-距離」，輸入數值，按 ✔。\n\n- 選面時，第一個距離量在你選的那個面上（第二個距離量在邊另一側的面上）；勾「反轉方向」則對調。例如選頂面、距離 3 與 1：頂面縮 3、側面往下切 1；反轉後頂面縮 1、側面切 3。\n- 選邊線時，第一個距離量在名稱排序較前的相鄰面（勾「反轉方向」換另一面）。\n- 選面倒的是它所有的邊線，相切連續的邊與接縫不處理，面之後多出來的邊也會倒。\n\n驗證過的例子：40 × 30 × 12 的方塊，頂面導角 2 × 2：14130.67 mm³。',
  'help.deleteFace.summary': '刪掉選取的面，並把相鄰的面延伸到相接，常用來去掉孔或圓角。',

  'help.deleteFace.body':
    '點要刪除的面（可點多個，再點一次取消），按 ✔：周圍的面延伸補合缺口，孔與圓角因此消失。\n\n- 編輯時畫面顯示這個特徵之前的模型；點面加入或移除。\n- 勾「刪除鑽孔」：連同只被這些面圍住的面（例如盲孔的孔底）一起刪。\n- 用在匯入的模型（沒有特徵歷史）去掉孔與圓角；自己做的零件直接刪掉原來的特徵比較好。',

  'help.deleteFace.keywords': '刪除面 去除孔 去除圓角 匯入模型 直接編輯',

  'help.deleteFace.see': 'move-face fillet import-step',
  'help.hole.summary': '在草圖的點上鑽孔：直孔、沉頭孔、錐孔（countersink）、螺紋孔或定位銷孔，孔徑與深度在面板設定。',

  'help.hole.body':
    '先在要打孔的面上畫一張草圖，在孔的位置畫「單獨的點」（不是線的端點或圓心），選這張草圖再按這個指令。孔打在草圖裡每一個單獨的點上，往材料裡面鑽。\n\n- 孔的種類：直孔、柱孔（沉頭孔）、錐孔（埋頭孔）、螺紋孔（底孔）、定位銷孔。\n- 標準規格：選一個規格，孔徑、沉頭尺寸取自表（螺紋孔鑽到攻牙底孔的直徑，其他的是間隙孔）；選「自訂」自己填孔徑。表的數值請對照公司的標準。\n- 柱孔要填沉頭直徑與沉頭深度；錐孔要填錐孔直徑與角度（預設 90°）；沉頭要比孔大，深度要比孔淺，否則特徵出錯並說明。\n- 深度：給定深度或完全貫穿，可以反轉方向。\n- 定位銷孔：填標稱直徑與公差等級（例如 H7）與入口導角；孔以標稱直徑做出，面板會列出孔與搭配的銷的上下限。\n\n例子：Ø6 的 H7 定位銷孔，孔的範圍是 6.000 到 6.012 mm（+0.012／0）。點的位置沒有材料時（孔在本體外面，或方向反了），特徵出錯並說明是哪一點。',

  'help.hole.keywords': '異型孔 孔 鑽孔 沉頭 柱孔 錐孔 螺紋孔 定位銷 公差 H7',

  'help.hole.see': 'sketch extrude-cut concept.property-manager',
  'help.screwBoss.summary': '在草圖的點上長出帶孔的螺柱，可加拔模與肋。',

  'help.screwBoss.body':
    '在草圖的每個自由點上做一根螺柱，從草圖所在的面（例如殼的內側底面）沿法向長出去；孔從頂端往下。\n\n- 外徑、孔徑（先導孔，指孔口的直徑；自攻螺絲的底孔要查螺絲的規格）、高度、孔深（空白＝到底）。\n- 外壁拔模（往頂端收，空白＝沒有）；孔也可以另外設拔模（往孔底縮小，型芯針才拔得出來），「同外壁」把兩者設成一樣。\n- 肋（補強片）：柱腳的三角形片，設數量、肋厚、往外長、肋高、起始角度（0° 是草圖的 x），平均分布；「去掉肋」取消。\n- 柱子會往本體裡埋一點，所以一定接得上；沒接到本體時特徵出錯。殼的底厚改了，螺柱跟著。',

  'help.screwBoss.keywords': '螺柱 螺絲柱 先導孔 肋 拔模 塑膠',

  'help.screwBoss.see': 'shell draft snap-hook',
  'help.baseFlange.summary': '以草圖建立鈑金的基材：封閉輪廓是平板，開放折線是折過的板。',

  'help.baseFlange.body':
    '鈑金零件的第一個特徵：選一張草圖再按這個指令，它也放整個零件的鈑金參數。\n\n- 封閉的輪廓是一片平板；開放的折線是折過的板（例如 U 形），轉角自動倒圓。\n- 板厚、折彎半徑（內側）、K 因子（長度不變的那一層離內側多遠，0 到 1，預設 0.5）。\n- 板寬（開放輪廓）：折過的板的寬度（預設 50）。「板厚往另一側」換板厚長的方向：折過的板的草圖折線預設是外側面，換邊後折線成為內側面。\n- 折彎的展開長度 = 平直段 + 折彎裕度，折彎裕度 = 角度（弧度）× (內側半徑 + K × 板厚)。\n\n驗證過的例子（板厚 1.5、折彎半徑 2）：60 × 40 的封閉輪廓是 60 × 40 × 1.5 = 3600 mm³ 的平板；U 形槽（外寬 60、外高 20、長 40）是 5678.3 mm³，面板寫展開長度 94.639，K 改成 0.4 是 94.168。',

  'help.baseFlange.keywords': '鈑金 基材凸緣 板厚 折彎半徑 K因子 展開長度 折彎裕度',

  'help.baseFlange.see': 'edge-flange hem flat-pattern sketch',
  'help.edgeFlange.summary': '在鈑金板的一條邊上折出凸緣，可設長度、角度與折彎半徑。',

  'help.edgeFlange.body':
    '在鈑金板的一條直邊上長出一個折彎加平直的凸緣，寬度是整條邊。\n\n- 在圖面點板的一條邊（點面沒有作用）。預設往你點的那條邊所在的面那一側折；「往另一面折」換邊。\n- 凸緣長度，預設從外側虛擬交點量（工程圖上的外側尺寸）；也可以選「內側虛擬交點」或「折彎之後」量。\n- 折彎角度（空白＝90°）與折彎半徑（空白＝基材的）。\n- 凸緣的位置：「材料在內」（外側對齊邊，板在這條邊附近被切掉一段）或「折彎在外」（從邊開始折，板不動）。\n- 起端與末端可以縮短，並在縮短處挖矩形的離隙，相鄰邊的凸緣就不會在角落貼在一起。\n\n驗證過的例子：板 100 × 50 × 1.5（7500 mm³）、折彎半徑 2、90°、長度 30 從外側量、材料在內：板切掉 262.5、折彎 323.98、平直段 1987.5，共 9548.98 mm³。',

  'help.edgeFlange.keywords': '鈑金 邊線凸緣 折彎 凸緣 長度 角度 離隙 縮短',

  'help.edgeFlange.see': 'base-flange hem flat-pattern concept.property-manager',
  'help.hem.summary': '把鈑金板的邊折回成摺邊（180° 折彎）。',

  'help.hem.body':
    '在鈑金板的一條直邊上做 180° 的折彎，板的一段折回來蓋在板上。\n\n- 在圖面點板的一條邊；「回折的長度（折彎之後）」是折回的平直段長度。\n- 「兩層的間隙（內側）」是兩層內側面之間的距離，折彎的內側半徑是它的一半；閉合的摺邊用很小的間隙（間隙不能是 0，沒有內側的折彎做不出形狀）。\n- 位置：「材料在內」（外側對齊邊）或「折彎在外」。\n- 起端與末端的縮短與離隙與邊線凸緣相同；也可以接在凸緣的末端做回折的唇。\n\n驗證過的例子：板 100 × 50 × 1.5，間隙 1（折彎內側半徑 0.5）、回折 10、材料在內：8394.52 mm³（板切掉 150、折彎 294.52、平直段 750）；改成折彎在外：8544.52 mm³。',

  'help.hem.keywords': '鈑金 摺邊 折邊 180 回折 間隙 閉合',

  'help.hem.see': 'edge-flange base-flange flat-pattern',
  'help.flatPattern.summary': '算出鈑金的平板型式（展開圖）、折彎線與折彎表，可輸出 DXF。',

  'help.flatPattern.body':
    '算出鈑金零件的平板型式（展開圖），在視窗裡畫出輪廓與折彎線（紅虛線）。這個零件要有基材凸緣，否則寫「這個零件不是鈑金件」。\n\n- 視窗列出外包尺寸、面積、板厚、體積，與折彎表（角度、內側半徑、方向「往上／往下」、折彎裕度、位置）。\n- 「輸出 DXF」把輪廓與折彎線寫成 DXF 檔。\n- 平板型式從折彎資料算（不展開實體），模型改了視窗跟著重算；什麼也不存進檔案。\n- 折過的基材凸緣上再長邊線凸緣或摺邊時還不能展開，會說明原因。\n\n驗證過的例子（板 100 × 50 × 1.5、半徑 2、K 0.5）：加一個 90°、長 30 從外側量、材料在內的凸緣，展開長度 100 − 2 × (2 + 1.5) + 30 + 4.3197 = 127.3197、寬 50、面積 6365.98，一個 90° 往上的折彎；K 改成 0.4 是 127.0841；展開的體積與折起來的相同（K = 0.5）。',

  'help.flatPattern.keywords': '鈑金 平板型式 展開 折彎線 折彎表 DXF 裕度',

  'help.flatPattern.see': 'base-flange edge-flange hem',
  'help.snapHook.summary': '在塑膠件上做懸臂樑加楔形鉤的卡榫。',

  'help.snapHook.body':
    '在草圖的每個自由點上做一根懸臂樑，從草圖所在的面沿法向長出去；樑的末端有楔形的鉤，往角度方向凸出：底下是平的（卡住的那一面），頂端是斜的（導入斜面）。\n\n- 榫寬、樑厚（沿角度方向）、樑長、鉤高、鉤長（凸出量）。\n- 樑會往本體裡埋一點，所以一定接得上。\n- 尺寸要手填；程式不算樑的應變，也不替你選材料與角度。\n- 配合的另一半用「卡榫窗」切出窗口。',

  'help.snapHook.keywords': '卡榫 扣勾 懸臂樑 鉤 塑膠',

  'help.snapHook.see': 'snap-catch vent screw-boss',
  'help.snapCatch.summary': '在塑膠件上做供卡榫扣住的矩形窗。',

  'help.snapCatch.body':
    '在草圖的每個自由點上切一個矩形的窗，給卡榫的鉤卡住。\n\n- 從草圖所在的面往本體裡切「切入深度」；窗的深度要超過壁厚才會穿透。\n- 尺寸要手填：鉤的寬度與凸出量，再加上製程需要的間隙。\n- 在殼的開口方向上，底切分析會找到這個窗（它是底切的），開模時要用滑塊或手動抽芯。',

  'help.snapCatch.keywords': '卡榫窗 窗 矩形 底切',

  'help.snapCatch.see': 'snap-hook vent undercut-analysis',
  'help.vent.summary': '在塑膠件的面上做一排排氣槽。',

  'help.vent.body':
    '在草圖的每個自由點上切一排槽，用在外殼的通風口。\n\n- 槽數、槽距（中心到中心）、槽的尺寸與角度；排以點為中心，槽的長邊沿角度方向；槽可以是圓頭。\n- 從草圖所在的面往本體裡切「切入深度」；深度超過壁厚才會穿透，但也會切到更後面的壁，所以不要超過太多。',

  'help.vent.keywords': '排氣口 通風 槽 外殼',

  'help.vent.see': 'snap-catch shell sketch',
  'help.draft.summary': '讓選取的面相對中立面傾斜一個脫模角度。',
  'help.draft.body':
    '點選中立面（先選），再點要拔模的面，輸入「拔模角度」，按 ✔。從中立面往外，側壁預設往中立面方向收窄；勾「反轉拔模方向」則離中立面越遠越寬。\n\n驗證過的例子：20 × 10 × 10 的方塊，頂面當中立面、四個側面拔 3°，體積約 1846.44 mm³；反轉後約 2160.89 mm³。三個側面要轉動視角才點得到。',
  'help.draft.keywords': '拔模 脫模 中立面 角度',
  'help.shell.summary': '把實體挖空成薄壁，移除你選的面當開口。',
  'help.shell.body':
    '點要移除的面，輸入「壁厚」，按 ✔（編輯時畫面是薄殼之前的模型，按 ✔ 才看得到結果）。\n\n- 預設往內加厚；勾「向外加厚」改往外。\n- 「壁厚不同的面」可以讓個別的平面壁有不同的厚度。\n- 壁厚大過形狀允許的（例如大於方塊邊長的一半）時特徵會出錯，訊息是「壁厚大於這個形狀允許的…」，改小就恢復。\n\n驗證過的例子：40 × 30 × 10 的方塊，頂面開口、壁厚 2 向內：4512 mm³；向外：5952 mm³。',
  'help.shell.keywords': '薄殼 抽殼 壁厚 開口 向外加厚',
  'help.moveFace.summary': '把選取的平面推動一段距離，周圍的面跟著延伸，用來直接修改匯入的模型。',

  'help.moveFace.body':
    '點一個平面，輸入「距離」，按 ✔：這個面沿外法向移動，相鄰的面跟著延伸或縮短，用來直接修改匯入的模型。\n\n- 負值往材料內。\n- 斜面維持原本的斜度。\n- 與它相切的面（例如圓角）要先處理，否則特徵出錯並說明。',

  'help.moveFace.keywords': '移動面 直接編輯 匯入模型 距離',

  'help.moveFace.see': 'delete-face fillet import-step',
  'help.offsetSurface.summary': '把選取的面偏移一段距離，做成曲面本體。',

  'help.offsetSurface.body':
    '點要偏移的面（選一個區域的所有面就偏移那個區域），輸入「偏移距離」，按 ✔：做出一個新的曲面本體，原本的本體不動。\n\n- 正值往面的外側，負值往內側。\n- 轉角的接合：圓弧（每一點都離來源同樣的距離）或交會（尖角）。\n- 偏移完會量測結果，與要求的距離差超過容許值（0.05 mm）就失敗，並說出差多少。\n- 曲面本體不是零件：不算質量、不列入零件表、不參與干涉與工程圖，輸出 STEP 時當殼。\n- 編輯時顯示偏移後的結果。',

  'help.offsetSurface.keywords': '偏移曲面 曲面 偏移 型面',

  'help.offsetSurface.see': 'thicken knit split-line',
  'help.splitLine.summary': '把草圖的封閉外圈投影到面上，把面切成區域。',

  'help.splitLine.body':
    '先畫一個封閉輪廓的草圖，再按這個指令：選「要投影的草圖」與「要分割的面」，輪廓沿草圖法向投影到面上，面被分成幾個區域。\n\n- 區域面有自己的名稱（`<特徵>:side:<草圖>.<圈>`），改了草圖名字不變，可以選來做偏移曲面。\n- 方向不對時選「反轉投影方向」；「穿透全部」讓視線穿過的每一層面都分割。\n- 輪廓的邊不要貼著圓柱或圓錐的接縫，否則會失敗。\n- 投影不到面、面不見、草圖沒有封閉，都說明原因。',

  'help.splitLine.keywords': '分割線 投影 區域 面 草圖',

  'help.splitLine.see': 'offset-surface trim-surface sketch',
  'help.knit.summary': '把數個曲面縫成一個曲面本體或實體。',

  'help.knit.body':
    '把幾個曲面本體縫成一個：勾選清單裡的本體，或在圖面點本體的面。\n\n- 縫織容差：相距不到這個值的邊縫在一起；空白表示 0.01 mm。\n- 縫完是封閉的，可以勾「封閉時做成實體」得到實體；縫完還有自由邊表示沒有封閉，結果仍是曲面。\n- 結果是第一個選的本體，其餘被用掉；面的名稱不變。\n- 沒有曲面本體可選時，先做偏移、填補或平坦曲面。',

  'help.knit.keywords': '縫織 曲面 縫合 實體 容差',

  'help.knit.see': 'offset-surface thicken fill-surface',
  'help.fillSurface.summary': '用一圈邊界補出一個曲面。',

  'help.fillSurface.body':
    '點一圈邊線圍出的邊界，在上面補一個曲面，是一個新的曲面本體。\n\n- 與相鄰面的連續性：相切或只接觸。相切時，邊線只有一個相鄰面（例如曲面上的洞）才會貼著它。\n- 填補的結果離邊線最遠多少、切線差幾度，會顯示在面板下方；超過容許值就失敗。\n- 常用來補曲面上的洞，再縫織成實體。',

  'help.fillSurface.keywords': '填補曲面 補洞 相切 連續性',

  'help.fillSurface.see': 'knit flat-surface offset-surface',
  'help.flatSurface.summary': '用一圈封閉的邊補出一個平坦曲面。',

  'help.flatSurface.body':
    '選一圈在同一個平面上的邊線，補一個平面，是一個新的曲面本體。\n\n- 邊線要連成一圈、全在同一個平面上，否則特徵出錯並說明。\n- 結果可以與其他曲面縫織成實體。',

  'help.flatSurface.keywords': '平坦曲面 平面 補面 封口',

  'help.flatSurface.see': 'fill-surface knit',
  'help.trimSurface.summary': '用草圖在曲面上切出區域，保留其中一側。',

  'help.trimSurface.body':
    '草圖的封閉輪廓沿草圖法向投影到曲面本體的面上，把面分開，保留輪廓裡面（或外面），其餘去掉。\n\n- 選草圖與曲面本體，「保留」選「輪廓裡面」或「輪廓外面」。\n- 方向不對時選「反轉」。\n- 輪廓的邊不要貼著圓柱或圓錐的接縫。\n- 只用輪廓的外圈，不處理草圖裡面的洞。',

  'help.trimSurface.keywords': '修剪曲面 修剪 保留 輪廓 曲面',

  'help.trimSurface.see': 'split-line extend-surface knit',
  'help.extendSurface.summary': '把曲面本體的邊延伸一段距離。',

  'help.extendSurface.body':
    '選曲面本體的邊線，輸入「延伸距離」：面順著原本的走向長出去。\n\n- 只能延伸只有一個面的曲面本體。\n- 選的邊線決定延伸哪一邊；繞一圈的邊（沒有端點）不能延伸。\n- 用在「以曲面除料」之前，把曲面延伸到整個穿過實體。',

  'help.extendSurface.keywords': '延伸曲面 延伸 距離 邊線',

  'help.extendSurface.see': 'cut-with-surface trim-surface offset-surface',
  'help.thicken.summary': '把曲面本體加厚成實體。',

  'help.thicken.body':
    '選一個曲面本體，輸入「厚度」，按 ✔：曲面加厚成實體。\n\n- 正值往曲面的法向那一側，負值往另一側。\n- 結果取代這個曲面本體，成為實體（曲面用掉了）。\n- 做完會量測最遠點離曲面是不是這個厚度，差太多就失敗。',

  'help.thicken.keywords': '加厚 厚面 曲面 實體 厚度',

  'help.thicken.see': 'knit offset-surface cut-with-surface',
  'help.cutWithSurface.summary': '用曲面當刀具，從實體切除一側。',

  'help.cutWithSurface.body':
    '用曲面本體把實體切掉一側：選「要除料的實體」與「除料用的曲面本體」，設定「除料的方向」（平面的法向）。\n\n- 曲面沿方向掃過的部分從實體除去，曲面本體不變。\n- 曲面要整個穿過實體；太小就先用「延伸曲面」。\n- 「反轉方向」除去曲面的另一側。\n- 在圖面點實體或曲面的面也可以選。',

  'help.cutWithSurface.keywords': '以曲面除料 曲面切割 分模 除料',

  'help.cutWithSurface.see': 'extend-surface thicken extrude-cut',
  'help.lipGroove.summary': '在塑膠件的面上依外輪廓做出唇或溝槽，讓上下蓋扣合。',

  'help.lipGroove.body':
    '在殼的邊緣面（或任一平面）上，沿面的外輪廓做一圈唇或溝槽，讓上蓋與底殼卡合。\n\n- 放在哪個面上：點一個平面。\n- 種類：唇（從面往外長「高度」）或溝槽（往本體裡切「深度」）。\n- 離邊緣、環的寬度：輪廓往內偏移「離邊緣」與「離邊緣＋寬度」，兩條線之間就是環。\n- 環要整個在面上，不能蓋到面上的洞，所以殼的邊緣面寬度要放得下，否則特徵出錯並說明。\n- 蓋子的溝槽用同一個特徵，寬度與深度照配合的間隙加大。',

  'help.lipGroove.keywords': '唇 溝槽 蓋 配合 殼 邊緣',

  'help.lipGroove.see': 'shell draft snap-hook',
  'help.combine.summary': '把本體相加、相減（主要本體減去工具本體）或取交集。',

  'help.combine.body':
    '把幾個本體組合成一個：選「主要本體」與「要組合的本體」，再選組合類型。\n\n- 加入：本體相接時合併成一個。\n- 減除：主要本體減去其他本體（刀具）。\n- 共同：只留各本體重疊的部分（交集）。\n- 結果是主要本體，其他本體被用掉。在圖面點本體的面可以加入或移除；加入需要本體相接，減除與共同取主要本體與它們的關係。',

  'help.combine.keywords': '組合 本體 相加 相減 交集 布林',

  'help.combine.see': 'mirror extrude concept.property-manager',
  'help.linearPattern.summary': '沿一個或兩個方向複製排列所選的特徵。',

  'help.linearPattern.body':
    '把所選的特徵沿一個或兩個方向複製成幾份。\n\n- 要排列的特徵：勾一個特徵，或一個接著一個的幾個特徵（中間可以有草圖和基準）；排列的是它們對本體加上和移除的材料。\n- 方向 1：可以是直線邊線、基準軸或平面（取法向）；填「間距」與「實例數」（實例數包括原始特徵），「反轉方向」換邊。\n- 「加入方向 2（排成格子）」再加一個方向，成為列×行的格子。\n- 要跳過的實例：按一下略過那個實例，再按一次恢復；編號 0 是原始特徵，格子是「列×行」。\n\n例子：一個孔排 3 個、間距 15 mm，三個孔的位置在 0、15、30 mm；3 × 2 的格子是 6 個孔，跳過 1 個剩 5 個。',

  'help.linearPattern.keywords': '線性複製排列 陣列 排列 間距 實例 格子 孔',

  'help.linearPattern.see': 'circular-pattern mirror hole concept.property-manager',
  'help.circularPattern.summary': '繞一條軸複製排列所選的特徵。',

  'help.circularPattern.body':
    '把所選的特徵繞一條軸複製成幾份。\n\n- 要排列的特徵：勾一個特徵，或一個接著一個的幾個特徵。\n- 旋轉軸：可以是直線邊線、基準軸、圓柱面或圓錐面（取它的軸）。\n- 角度與實例數（實例數包括原始特徵）；勾「等間距（角度由實例平分）」時，角度是總角度，由所有實例平分。「反轉方向」換轉的方向。\n- 要跳過的實例：按一下略過，再按一次恢復。\n\n例子：一個孔繞中心軸排 6 個、等間距、角度 360°，孔每隔 60° 一個；排 4 個、角度 360° 是每隔 90°。',

  'help.circularPattern.keywords': '環狀複製排列 陣列 圓形 排列 軸 角度 實例',

  'help.circularPattern.see': 'linear-pattern mirror hole concept.property-manager',
  'help.mirror.summary': '以一個平面為鏡面，鏡射所選的特徵或本體。',

  'help.mirror.body':
    '以一個平面為鏡面，把特徵或整個本體鏡射到另一邊。\n\n- 鏡射什麼：選「特徵」（鏡射它們對本體加上和移除的材料）或「本體」（鏡射出整個本體的影像）。\n- 鏡射面：基準面或模型上的平面。\n- 「合併結果」：鏡射出來的本體和碰到的本體（包括原來的那個）連成一塊；不勾就成為新的本體。\n\n例子：10 × 10 × 10 的方塊，貼著鏡面（x = 0）的一側，以右基準面鏡射本體並合併：結果是 20 × 10 × 10 的一個實體，2000 mm³。',

  'help.mirror.keywords': '鏡射 對稱 鏡面 本體 特徵 合併',

  'help.mirror.see': 'linear-pattern circular-pattern concept.property-manager',
  'help.refPlane.summary': '建立參考用的基準面（偏移、角度、三點、平行等）。',

  'help.refPlane.body':
    '建立一個參考用的基準面，可以拿來畫草圖、當鏡射面、當伸長的終止面。\n\n- 類型：偏移（離參考面一段距離）、角度（0° 與參考面平行，90° 垂直）、三點（點頂點或參考點）、平行（通過點、與參考面平行）、垂直（通過點、與直線邊線或基準軸垂直）、中間（兩個互相平行的面正中間）、相切（與圓柱面相切並與參考面平行，「反轉方向」換到圓柱另一側）。\n- 參考面可以在圖面中點平面，或按面板裡的基準面按鈕（前、上、右）。\n- 基準面跟著模型走：參考的面改了，基準面也跟著移動。',

  'help.refPlane.keywords': '基準面 參考幾何 偏移 角度 三點 中間 相切',

  'help.refPlane.see': 'ref-axis ref-point coord-sys',
  'help.refAxis.summary': '建立參考用的基準軸。',

  'help.refAxis.body':
    '建立一條基準軸，當旋轉軸、排列的方向或圓周複製排列的軸。\n\n- 類型：直線邊線（軸沿著所選的邊）、兩點（通過兩個頂點或參考點，方向從第一點指向第二點）、圓柱或圓錐面（面的旋轉軸）、兩平面（兩個平面相交的直線）。\n- 兩個平面平行（沒有交線）時特徵出錯並說明。\n- 基準軸跟著它參考的元素走。',

  'help.refAxis.keywords': '基準軸 軸 圓柱 兩點 兩平面 參考幾何',

  'help.refAxis.see': 'ref-plane ref-point circular-pattern',
  'help.refPoint.summary': '建立參考用的點。',

  'help.refPoint.body':
    '建立一個參考點，當三點基準面的點、基準軸的端點或量測的位置。\n\n- 類型：座標（從零件原點量起的 X、Y、Z，可以寫運算式）、中心（圓形邊線取圓心，直線邊線取中點，球面取球心，其他的面取面的中心）、軸與平面的交點（基準軸或直線邊線穿過平面的位置）。\n- 軸與平面平行（沒有交點）時特徵出錯並說明。',

  'help.refPoint.keywords': '參考點 座標 圓心 中點 交點 參考幾何',

  'help.refPoint.see': 'ref-plane ref-axis coord-sys',
  'help.coordSys.summary': '建立座標系統，輸出 STEP 時可以用來定位。',

  'help.coordSys.body':
    '建立座標系統，輸出 STEP 時可以選它當座標原點與方向。\n\n- 原點：選一個頂點或參考點；不選就是零件原點。\n- X 軸沿所選的方向（直線邊線、基準軸或平面的法向）；Y 軸取所選方向中垂直於 X 的部分；Z = X × Y（永遠是右手系）。\n- 「反轉 X 軸」「反轉 Y 軸」換方向。\n- X 與 Y 方向平行時決定不了 Z，特徵出錯並說明。',

  'help.coordSys.keywords': '座標系統 原點 STEP 輸出 方向 右手系',

  'help.coordSys.see': 'ref-plane export-step ref-point',
  'help.importStep.summary': '把 STEP 檔讀進來成為零件的本體，必要時自動修復。',

  'help.importStep.body':
    '把 STEP 檔讀進來成為零件的一個本體，必要時自動修復。\n\n- 在新零件按它，在瀏覽器的視窗選 .step 檔；等幾秒，3D 視窗出現模型，設計樹多一列「輸入1」。\n- 雙擊「輸入1」（單擊只是選取）打開面板：「輸入的資料」（檔名，資料存放在零件檔中，不需要原始檔案）與「診斷報告」（檔案內容有幾個實體與面、有效性檢查結果、做了什麼修改）。\n- 「縫合容差」（預設 0.01）只有檔案裡只有曲面、沒有實體時才有作用。\n- 之後可以在它上面加特徵：草圖畫在它的面上、伸長、刪除面、移動面等。\n- 診斷報告有警告時，用「檢查幾何」再看一次。\n\n驗證過的例子：40 × 30 × 10 的板、中間一個半徑 4 的孔：體積 40 × 30 × 10 − π × 4² × 10 ≈ 11497 mm³。',

  'help.importStep.keywords': '輸入 STEP 匯入 本體 診斷報告 修復 縫合',

  'help.importStep.see': 'delete-face move-face check-part export-step',

  // ---------------------------------------------------------------- assembly
  'help.insertComponent.summary': '把零件檔插入組合件，成為零組件。',

  'help.insertComponent.body':
    '把零件檔（.3dbx）或另一個組合件（.3dba，成為次組合件）加進組合件，成為零組件。\n\n- 在「要插入的零件」清單點一個，等它載入完，在 3D 視窗空白處按一下放置；按面板上的 ✔ 則放在原點。\n- 同一個零件可以插入很多次，設計樹的名字帶編號：削邊銷<1>、削邊銷<2>。\n- 次組合件是剛性的：它自己的結合不會因為外面的動作而改變，裡面的零件在這裡不能單獨移動，要改請開啟次組合件。\n- 「標準件圖庫」：選種類（內六角螺絲 ISO 4762、定位銷 ISO 8734、平墊圈 ISO 7089）、規格與長度，加進來；它們是用變數做成的零件檔，沒有螺紋。',

  'help.insertComponent.keywords': '插入零組件 零件 次組合件 標準件 圖庫 螺絲 銷',

  'help.insertComponent.see': 'new-assembly mate move-component',
  'help.mate.summary': '用結合限制零組件之間的位置關係（重合、平行、同心、距離…）。',

  'help.mate.body':
    '用結合規定兩個零組件的面、邊或頂點怎麼貼，讓零件定位。\n\n- 在 3D 視窗依序點兩個不同零組件上的元素（例如銷的圓柱面，再點板上孔的內壁）；基準面與原點用圖面左上角那棵小樹選。點次組合件時，可以直接點它裡面零件的面。\n- 「標準結合」：重合、平行、垂直、相切、同軸心、鎖住、距離、角度。程式依你選的元素建議一個（亮著的），不能用的是灰色。\n- 「結合對正」（同向對齊／反向對齊）可以換；選距離或角度要填數值，也可以設最小與最大的限制。\n- 「進階結合」：寬度（兩個寬度面與兩個薄片面）、相互對稱（兩個同類元素與一個對稱面）。\n- 面板寫「結合成立」就按 ✔ 加入；寫「這個結合與之前的結合矛盾，組合件會過多定義」就不要加。\n- 設計樹有「結合」資料夾，每個結合一列，並標出它的狀態。\n- 設計樹裡名字前的 (f) 是固定、(-) 是可以動的；第一個零組件自動固定。',

  'help.mate.keywords': '結合 重合 平行 垂直 相切 同軸心 鎖住 距離 角度 寬度 對稱 定位',

  'help.mate.see': 'move-component fix-component insert-component',
  'help.moveComponent.summary': '用拖曳或輸入數值移動零組件。',

  'help.moveComponent.body':
    '拖曳或輸入數值移動零組件；也用來旋轉（見「旋轉零組件」）。\n\n- 在 3D 視窗按住零組件左鍵拖曳；零組件只沿結合留下的自由度移動。Esc 取消這次拖曳。\n- 「依據 Delta XYZ」：移動一段 ΔX、ΔY、ΔZ；「至 XYZ 位置」：把零組件的原點移到這個位置（組合件座標）；輸入後按「套用」或 Enter。每次移動是一個復原步驟。\n- 「碰撞偵測（停在接觸前）」：勾選後，拖曳時零組件碰到別的零組件就停在接觸前，碰到的顯示成紅色；開始拖曳前就已經重疊的不算。\n- 固定的、已被結合完全定義的、被抑制的零組件不能移動，面板會說原因；爆炸視圖展開時也不能移動，要先按「收合」。次組合件裡面的零件不能單獨移動。',

  'help.moveComponent.keywords': '移動零組件 拖曳 delta 位置 碰撞 自由度',

  'help.moveComponent.see': 'rotate-component mate fix-component',
  'help.rotateComponent.summary': '旋轉零組件。',

  'help.rotateComponent.body':
    '旋轉零組件：用拖曳，或輸入繞組合件 X、Y、Z 軸的角度。\n\n- 面板上選「旋轉」後，在 3D 視窗拖曳零組件就是旋轉；右鍵拖曳一律旋轉。零組件只沿結合留下的自由度轉。\n- 也可以輸入角度（度）繞組合件的 X、Y、Z 軸轉，按「套用」；每次是一個復原步驟。\n- 固定的、已被結合完全定義的、被抑制的零組件不能旋轉。',

  'help.rotateComponent.keywords': '旋轉零組件 旋轉 角度 拖曳 右鍵',

  'help.rotateComponent.see': 'move-component mate fix-component',
  'help.explode.summary': '建立爆炸視圖：把零組件沿方向分開，只是顯示，不改變組裝位置。',

  'help.explode.body':
    '建立爆炸視圖：把零組件沿方向分開來看。這只是顯示，零組件真正的位置不變。\n\n- 勾「要移動的零組件」，選「方向」（組合件的軸，或零組件的元素）與「距離」，按「加入步驟」；步驟的位移會累加。\n- 「爆炸」展開、「收合」回到組裝的樣子，一點不差；展開與收合可逆，復原一步有效。\n- 步驟可以「編輯」「更新步驟」，用「上移」「下移」換順序，「刪除」。\n- 展開時不能移動零組件或編輯結合，要先按「收合」。輸出 STEP 永遠是組裝的位置。\n- 限制：只能移動頂層零組件、沒有爆炸線與動畫、只有一組爆炸。',

  'help.explode.keywords': '爆炸視圖 爆炸 分解 收合 步驟',

  'help.explode.see': 'bom interference mate',
  'help.measureAssembly.summary': '量測組合件中選取元素之間的距離與角度。',

  'help.measureAssembly.body':
    '量測組合件中選取元素之間的距離與角度，數字是在組合件座標下量的。\n\n- 在 3D 視窗點元素（面、邊、頂點，可以在不同零組件上）；選了兩個之後再點別的元素就重新開始，同一個元素再點一次取消它。\n- 一個元素：面是面積，邊是長度，圓是半徑與直徑，頂點是座標。兩個元素：最短距離（接觸時是 0），兩個頂點還有 ΔX、ΔY、ΔZ；夾角是銳角（0 到 90 度）。\n- 按「結束」或 Esc 關閉。',

  'help.measureAssembly.keywords': '量測 測量 距離 夾角 面積 半徑 座標',

  'help.measureAssembly.see': 'measure-part clearance interference',
  'help.clearance.summary': '檢查零組件之間的最小間隙是否夠。',

  'help.clearance.body':
    '檢查零組件之間的最小間隙夠不夠，並算零組件的取放空間。\n\n- 「最小餘隙」輸入一個數值，按「檢查」：列出比這個值更近的零組件對，與它們的距離（精確的最短距離）；接觸的是 0，共用體積的標「干涉」；最近的點的位置也會列出。\n- 「取放空間」：先選一個零組件，選方向與長度，按「算取放空間」：算它沿這個方向最多能移動多遠才碰到別的零組件，並說碰到哪一個；已經重疊時說這個方向不能移動。\n- 組合件在檢查之後改過，結果已經過時，要再檢查一次。',

  'help.clearance.keywords': '餘隙 間隙 取放空間 距離 干涉',

  'help.clearance.see': 'interference check-assembly move-component',
  'help.interference.summary': '找出零組件之間重疊的體積（接觸不算）。',
  'help.interference.body':
    '「組合件」→「干涉檢查」：視窗列出共用體積的每一組零組件與重疊的體積，3D 視窗裡重疊的部分是紅色；在表格點一組，只顯示那兩個零組件，再點一次全部顯示。\n\n- 預設以頂層零組件為單位：子組合件算一個，陣列與鏡射的每個複製品各算一個。\n- 勾選「也檢查子組合件裡面的零件」，每個零件各算一個，子組合件裡面的零件也會互相比；名稱寫成「子組合件 › 零件」，同一個子組合件裡同名的零件以 <2>、<3> 分開。\n- 只有接觸不算干涉，重疊體積小於 0.001 mm³ 的也不報。隱藏的零組件會檢查，被抑制的不會。模型改變後視窗會說「模型已經變更」，按「重新檢查」。\n\n驗證過的例子：金樣夾具的兩個子組合件，各有一片定位板與兩根削邊銷，銷柄（半徑 5）放在板的孔（半徑 4）裡：勾選後 4 組，每組約 405.4 mm³，合計 1621.6；不勾選沒有干涉。',
  'help.interference.keywords': '干涉 重疊 碰撞 子組合件 子組合件內部 體積',
  'help.checkAssembly.summary': '檢查組合件的幾何是否有效。',

  'help.checkAssembly.body':
    '檢查組合件裡每一種零件的模型幾何：表格一列一個零件檔。\n\n- 「有問題」是指：有效性檢查沒通過、外殼沒有封閉（有只屬於一個面的開放邊），或體積為零或負數。\n- 列出實體數、面數、有問題的面、開放邊與體積；全部正常時下方寫「全部正常」。\n- 匯入的 STEP 與修復過的模型最需要檢查；有問題的面編號會列出來。',

  'help.checkAssembly.keywords': '檢查幾何 有效性 開放邊 外殼 體積',

  'help.checkAssembly.see': 'check-part clearance interference',
  'help.physicalAssembly.summary': '計算組合件的質量、重心與慣性矩。',

  'help.physicalAssembly.body':
    '計算組合件的質量、體積、表面積、質心與慣性矩，由各零件依位置合成（爆炸視圖不影響）。\n\n- 質量要每個零件都有材質才算完整：沒有選材質的零件，質量不在總質量裡，視窗會列出名字。\n- 列出每個零件的數量與單件質量；零件還沒讀好時會列出名字。\n- 表面積是各零件表面積的總和，不是組合件外殼的面積。\n- 單位：質量 g、體積 mm³、表面積 mm²、質心 mm、慣性矩 g·mm²。',

  'help.physicalAssembly.keywords': '物質特性 質量 質心 慣性矩 組合件 材質',

  'help.physicalAssembly.see': 'physical-part bom properties',
  'help.bom.summary': '產生零件表（數量、料號、廠商），可輸出 CSV。',

  'help.bom.body':
    '產生零件表：從組合件統計每種零件的數量，廠商與料號取自零件檔的「檔案屬性」。\n\n- 兩種結構：「只列零件」（攤平，次組合件展開）與「縮排（含次組合件）」（次組合件一列，裡面的零件縮排列在底下，數量是各層的數量）。\n- 欄位：項次、名稱、數量、廠商、料號、檔案。\n- 複製排列與鏡射的實例算進數量；被抑制的零組件不列，隱藏的要列；參考零件（衍生本體）不列。\n- 廠商與料號在零件的「工具」→「檔案屬性」加屬性「廠商」「料號」，存檔後重新開啟組合件才會出現。\n- 「輸出 CSV」寫成 .csv 檔，用 Excel 開。',

  'help.bom.keywords': '零件表 BOM 數量 料號 廠商 CSV 次組合件',

  'help.bom.see': 'properties explode physical-assembly',
  'help.patternLinear.summary': '沿方向複製排列零組件。',

  'help.patternLinear.body':
    '把一個零組件沿一或兩個方向複製成幾份：種子（原來的那個）加上它的複製品。\n\n- 選種子零組件，「方向 1」選組合件的 X、Y、Z 軸或零組件上的元素；填「實例數（含種子）」與「間距」，「反轉方向」換邊。\n- 「加入方向 2」再加一個方向，成為格子；編號是「列×行」。\n- 「要跳過的實例」：用逗號分隔的編號，略過那幾個。\n- 複製品是跟著種子的衍生零件：移動種子，它們跟著動；隱藏或抑制種子，它們也消失；複製品本身不能再加結合（請選種子上的元素）。\n- 一個排列最多有限定的實例數；間距要大於 0。\n\n例子：削邊銷排 4 支、間距 40：第 3 支在種子旁邊 80 mm 處。',

  'help.patternLinear.keywords': '零組件排列 線性複製排列 陣列 種子 實例',

  'help.patternLinear.see': 'pattern-circular mirror-component insert-component',
  'help.patternCircular.summary': '繞軸複製排列零組件。',

  'help.patternCircular.body':
    '把一個零組件繞一條軸複製成幾份。\n\n- 選種子零組件，「旋轉軸」選組合件的 X、Y、Z 軸或零組件上的元素（直線邊線、圓柱面或圓形邊線、平面）。\n- 「實例數（含種子）」與「角度」；勾「等間距（角度是總角度）」時，角度由所有實例平分。「反轉方向」換轉的方向。\n- 「要跳過的實例」略過幾個。\n- 複製品是跟著種子的衍生零件，與線性排列相同。\n\n例子：削邊銷繞組合件的 Z 軸排 4 支、角度 90：每次轉 90°。',

  'help.patternCircular.keywords': '零組件排列 環狀複製排列 陣列 軸 角度',

  'help.patternCircular.see': 'pattern-linear mirror-component insert-component',
  'help.mirrorComponent.summary': '鏡射零組件。',

  'help.mirrorComponent.body':
    '把一個零組件鏡射到鏡射面的另一側，成為剛體的鏡像件。\n\n- 選零組件，「鏡射面」選前、上或右基準面。\n- 鏡像件不另存檔：開檔時由原件算出來；它跟著原件走。\n- 鏡像件列在零件表裡自成一項；本身不能再加結合。',

  'help.mirrorComponent.keywords': '鏡射零組件 鏡像 對稱 零件表',

  'help.mirrorComponent.see': 'pattern-linear pattern-circular bom',
  'help.fixComponent.summary': '把零組件固定在目前的位置，不受結合影響。',

  'help.fixComponent.body':
    '把零組件固定在目前的位置：結合與拖曳都不會移動它。\n\n- 第一個放進組合件的零組件自動固定在原點；設計樹裡名字前的 (f) 表示固定。\n- 固定的零組件不能拖曳或旋轉，面板會說「已固定」。\n- 要讓它又能動，用「浮動」。',

  'help.fixComponent.keywords': '固定 零組件 位置 原點',

  'help.fixComponent.see': 'float-component mate move-component',
  'help.floatComponent.summary': '讓固定的零組件可以被結合與拖曳移動。',

  'help.floatComponent.body':
    '讓固定的零組件可以被結合與拖曳移動。\n\n- 設計樹裡名字前的 (-) 表示可以動。\n- 浮動的零組件要靠結合定位；沒有結合限制的方向它可以自由拖動。',

  'help.floatComponent.keywords': '浮動 固定 零組件 移動',

  'help.floatComponent.see': 'fix-component mate move-component',

  // ---------------------------------------------------------------- sketch
  'help.construction.summary': '把選取的圖元切換成幾何建構線（虛線，不參與輪廓）。',

  'help.construction.body':
    '把選取的圖元切換成幾何建構線（虛線）：它們幫助定位，但不參與輪廓，也不會被伸長。\n\n- 先選圖元再按；選的圖元全都已經是建構線時，按一次變回一般線。\n- 中心線（旋轉用的軸）也是建構線。',

  'help.construction.keywords': '幾何建構線 建構線 虛線 中心線 輔助線',

  'help.construction.see': 'sketch exit-sketch revolve',
  'help.exitSketch.summary': '離開草圖並儲存修改，回到特徵設計。',

  'help.exitSketch.body':
    '離開草圖：儲存修改，回到特徵設計，設計樹多一列草圖。\n\n- 也可以按 3D 視窗右上角綠色的 ✔。\n- 要取消這次對草圖的修改，用「復原」。',

  'help.exitSketch.keywords': '離開草圖 完成草圖 確認',
  'help.exitSketch.see': 'sketch',
  'help.toolLine.summary': '畫直線：按一下設起點，再按一下設終點，可連續畫，Esc 或按兩下結束。',
  'help.toolLine.body':
    '- 起點可以吸到草圖的點、原點、模型的邊與頂點；游標旁會顯示是什麼（重合、中點、模型端點…）。\n- 接近水平或垂直（3° 內）自動加水平或垂直關係；方向接近另一條線時自動加共線、平行或互相垂直；從圓弧端點沿切線畫加相切。\n- 與其他草圖點水平或垂直對齊（5 像素內）時，出現灰色虛線並加對齊關係。\n- 畫回第一個點會封閉並結束連續畫線。',
  'help.toolLine.see': 'concept.sketch-snaps',
  'help.toolCenterline.summary': '畫中心線（幾何建構線），可當旋轉軸或鏡射線。',

  'help.toolCenterline.body':
    '在草圖裡按「草圖」→「中心線」：按一下設定起點，再按一下設定終點，按 Esc 結束。\n\n- 中心線是幾何建構線（虛線），不參與輪廓，也不會被伸長。\n- 用來當旋轉特徵的旋轉軸，或當草圖「鏡射」的鏡射軸。\n- 起點與終點可以吸到草圖的點、原點、模型的邊與頂點，見「草圖的吸附與推斷」。',

  'help.toolCenterline.keywords': '中心線 軸 建構線 旋轉軸 鏡射軸',

  'help.toolCenterline.see': 'tool-line tool-mirror revolve',
  'help.toolRect.summary': '用兩個對角畫矩形，四邊自動加水平與垂直關係。',

  'help.toolRect.body':
    '按一下設定第一個角落，再按一下設定對角，畫出矩形（兩次按之間不用拖曳）。\n\n- 四條邊自動加水平與垂直關係，所以矩形永遠是正的；尺寸（用「智慧型尺寸」）才決定它的大小與位置。\n- 角落可以吸到草圖的點、原點、模型的邊與頂點，見「草圖的吸附與推斷」。\n- 要以原點為中心時用「中心矩形」。',

  'help.toolRect.keywords': '邊角矩形 矩形 對角 水平 垂直',

  'help.toolRect.see': 'tool-centerRect tool-dimension concept.sketch-snaps tool-line sketch',
  'help.toolCenterRect.summary': '用中心與一個角落畫矩形。',

  'help.toolCenterRect.body':
    '按一下設定矩形的中心（例如座標原點），再按一下設定一個角落。\n\n- 矩形對中心對稱，四邊自動加水平與垂直關係。\n- 中心可以吸到原點、草圖的點、模型的點，這樣矩形就以它為中心。',

  'help.toolCenterRect.keywords': '中心矩形 矩形 中心 原點 對稱',

  'help.toolCenterRect.see': 'tool-rect tool-dimension concept.sketch-snaps tool-line sketch',
  'help.toolCircle.summary': '畫圓：按一下設圓心，再按一下設半徑。',

  'help.toolCircle.body':
    '按一下設定圓心，再按一下設定半徑。\n\n- 圓心可以吸到草圖的點、原點、模型的點（例如孔的圓心）。\n- 用「智慧型尺寸」標直徑，再標圓心的位置。\n- 圓用在伸長（成為圓柱）、孔的位置（異型孔用的是單獨的點，不是圓）等。',

  'help.toolCircle.keywords': '圓 圓心 半徑 直徑',

  'help.toolCircle.see': 'tool-perimeterCircle tool-dimension concept.sketch-snaps tool-line sketch',
  'help.toolPerimeterCircle.summary': '用圓周上的三個點畫圓。',

  'help.toolPerimeterCircle.body':
    '按三下，在圓周上的三個點畫圓：第一點、第二點、第三點。\n\n- 三點在同一條線上時沒有圓，會說「三點共線，無法產生圓」。\n- 要用圓心與半徑畫圓時用「圓」。',

  'help.toolPerimeterCircle.keywords': '周圍圓 三點圓 圓周 圓',

  'help.toolPerimeterCircle.see': 'tool-circle tool-threePointArc concept.sketch-snaps tool-line sketch',
  'help.toolArc.summary': '用圓心、起點、終點畫圓弧。',

  'help.toolArc.body':
    '按一下設定圓心，再按一下設定起點（決定半徑），再按一下設定終點。\n\n- 圓弧的兩個端點是草圖的點，其他圖元可以接在上面。\n- 起點與終點的位置可以吸到草圖的點與模型的點。\n- 其他畫法：「相切弧」（從線或弧的端點接下去）與「三點弧」（起點、終點、弧上一點）。',

  'help.toolArc.keywords': '圓弧 圓心 起點 終點',

  'help.toolArc.see': 'tool-tangentArc tool-threePointArc concept.sketch-snaps tool-line sketch',
  'help.toolTangentArc.summary': '從直線或圓弧的端點畫相切的圓弧。',

  'help.toolTangentArc.body':
    '按一下直線或圓弧的端點，再按一下設定終點：畫出與那條線或弧相切的圓弧，並自動加相切關係。\n\n- 起點必須是直線或圓弧的端點，否則會說「切線弧必須從直線或圓弧的端點開始」。\n- 用來畫圓滑接合的輪廓，例如直線接圓弧再接直線。',

  'help.toolTangentArc.keywords': '相切弧 切線弧 圓弧 端點',

  'help.toolTangentArc.see': 'tool-arc tool-threePointArc concept.sketch-snaps tool-line sketch',
  'help.toolThreePointArc.summary': '用起點、終點與弧上一點畫圓弧。',

  'help.toolThreePointArc.body':
    '按一下設定起點，再按一下設定終點，再按一下圓弧上的一點：畫出通過三點的圓弧。\n\n- 三點在同一條線上時沒有圓弧，會說「三點共線，無法產生圓弧」。\n- 起點與終點可以先放在要接的位置，再拉出弧的凸度。',

  'help.toolThreePointArc.keywords': '三點弧 圓弧 起點 終點 弧上一點',

  'help.toolThreePointArc.see': 'tool-arc tool-tangentArc concept.sketch-snaps tool-line sketch',
  'help.toolPoint.summary': '放置一個點。',

  'help.toolPoint.body':
    '按一下放置一個點。\n\n- 「異型孔」（及螺柱、卡榫、排氣口）用草圖裡單獨的點當位置，不是線的端點或圓心。\n- 點可以吸到原點、模型的點，也可以用尺寸定位。\n- 單獨的點不屬於輪廓，不會被伸長。',

  'help.toolPoint.keywords': '點 孔位 位置',

  'help.toolPoint.see': 'hole screw-boss concept.sketch-snaps tool-line sketch',
  'help.toolDimension.summary': '標註尺寸：選一或兩個圖元，再點一下放置，輸入數值按 Enter。',
  'help.toolDimension.body': '- 選一條線標長度；選圓標直徑、選圓弧標半徑（弧長用面板的「標註弧長」）；選兩條線標角度；選兩點標距離。\n- 多餘的尺寸（會讓草圖過多定義的）會變成從動尺寸，顯示成灰色斜體加括號，只顯示量到的值，面板的尺寸清單可以切換「設為從動／設為驅動」。\n- 雙擊尺寸可以改數值，數值欄可以輸入運算式或方程式的變數。',
  'help.toolSlot.summary': '用兩個圓心與寬度畫長圓孔輪廓。',

  'help.toolSlot.body':
    '按一下設定第一個圓心，再按一下設定第二個圓心，再移動滑鼠決定寬度，按一下完成。\n\n- 長圓孔輪廓是兩條直線加兩個半圓：兩條邊與兩個圓弧相切，兩個圓弧半徑相等；剩下五個自由度（兩個圓心的位置與寬度）用尺寸決定。\n- 兩個圓心可以吸到草圖的點與模型的點。',

  'help.toolSlot.keywords': '長圓孔 槽 長槽 圓心 寬度',

  'help.toolSlot.see': 'tool-circle tool-dimension concept.sketch-snaps tool-line sketch',
  'help.toolPolygon.summary': '畫正多邊形，邊數與內切／外接在面板設定。',

  'help.toolPolygon.body':
    '按一下設定多邊形的中心，再按一下設定大小與方向。\n\n- 左邊面板設「邊數」（預設 6）與「內切／外接」：外接時第二下點的是邊的中點，否則點的是頂點。\n- 多邊形由一個建構圓、落在圓上的頂點與相等的邊組成；剩下四個自由度（中心、大小、旋轉）用尺寸決定。',

  'help.toolPolygon.keywords': '多邊形 正多邊形 邊數 內切 外接 六角',

  'help.toolPolygon.see': 'tool-circle tool-dimension concept.sketch-snaps tool-line sketch',
  'help.toolSketchFillet.summary': '把兩條線的角落倒成圓角（草圖圓角）。',

  'help.toolSketchFillet.body':
    '把兩條線的角落倒成圓角：按一下兩條直線相交的角點，或依序按兩條直線。\n\n- 左邊面板設「圓角半徑」（預設 5）；半徑要大於 0。\n- 兩條線在圓弧接觸的位置縮短，圓弧與兩條線相切；角點留在原處當成虛擬交點，所以原來標到角點的尺寸仍然有效。半徑本身是一個尺寸。\n- 半徑太大、圓弧會超出直線的長度時，會說明並且不做。\n- 這是草圖的圓角；零件上的邊用「圓角」特徵。',

  'help.toolSketchFillet.keywords': '草圖圓角 圓角 角落 半徑 虛擬交點',

  'help.toolSketchFillet.see': 'tool-sketchChamfer fillet tool-trim',
  'help.toolSketchChamfer.summary': '把兩條線的角落倒成斜角（草圖導角）。',

  'help.toolSketchChamfer.body':
    '把兩條線的角落倒成斜角：按一下兩條直線相交的角點，或依序按兩條直線。\n\n- 左邊面板設兩個「導角距離」（預設都是 5）：從角點沿兩條線各退回的距離，兩個距離可以不同；要大於 0。\n- 兩條線在那兩個點縮短，用一條新的線連起來；角點留在原處當成虛擬交點，兩個距離是從它量起的尺寸。\n- 距離太大、會超出直線的長度時，會說明並且不做。\n- 這是草圖的導角；零件上的邊用「導角」特徵。',

  'help.toolSketchChamfer.keywords': '草圖導角 導角 斜角 距離 角落',

  'help.toolSketchChamfer.see': 'tool-sketchFillet chamfer tool-trim',
  'help.toolTrim.summary': '修剪：點線上被交點切出的一段，把它去掉。',

  'help.toolTrim.body':
    '按一下要修剪掉的那一段：直線、圓弧或圓上，夾在最近的兩個交點（或端點）之間的部分被去掉。\n\n- 中間的一段被去掉時，曲線分成兩段；後面那段繼承水平、垂直、平行、垂直與共線關係，圓弧的兩段半徑相等。新的端點落在切掉它的那條線上。\n- 沒有任何交點的曲線，點一下整條刪掉。\n- 整條曲線的長度與相等關係會被去掉（它不再是完整的一條）。\n- 只能修剪直線、圓弧或圓。',

  'help.toolTrim.keywords': '修剪 剪掉 交點 線段',

  'help.toolTrim.see': 'tool-extend tool-sketchFillet concept.sketch-snaps tool-line sketch',
  'help.toolExtend.summary': '延伸：點線的一端，延伸到擋住它的線。',

  'help.toolExtend.body':
    '按一下直線或圓弧要延伸的那一端附近：那一端延伸到路上遇到的第一條線。\n\n- 新的端點落在那條線上；舊的端點連同接在上面的東西一起去掉，整條曲線的長度與相等關係也去掉。\n- 這一端和其他圖元共用（別的圖元也用這個點）時不能延伸，會說明，要先把它們分開。\n- 這一端往前沒有可以延伸到的圖元時，也會說明。\n- 只能延伸直線或圓弧。',

  'help.toolExtend.keywords': '延伸 延長 端點 擋住',

  'help.toolExtend.see': 'tool-trim tool-sketchFillet concept.sketch-snaps tool-line sketch',
  'help.toolOffset.summary': '把選取的圖元向一側偏移一個距離。',
  'help.toolOffset.body': '先選取要偏移的線，再按這個指令；左邊面板有「偏移距離」。沒有選取就按時，面板最上方會提示先選取。',
  'help.toolMirror.summary': '以一條線為鏡像軸，鏡射選取的圖元。',

  'help.toolMirror.body':
    '先選取要鏡射的圖元，再按這個指令，再按一下鏡射軸（一條直線，可以是中心線）。\n\n- 每個點得到一個鏡射的對稱點，用「對稱」關係連在一起，所以原件改了，鏡像件跟著變；曲線建在對稱點上（圓弧轉向相反），圓的半徑保持相等。鏡射軸上的點是它自己的鏡像。\n- 原件之間的關係不複製，由對稱關係帶過去。\n- 沒有先選圖元時會說「請先選取要鏡射的圖元」；選的圖元都在鏡射軸上時說沒有東西可以鏡射。\n- 鏡射一次後回到選取。',

  'help.toolMirror.keywords': '草圖鏡射 鏡射 對稱 鏡像 中心線',

  'help.toolMirror.see': 'tool-centerline tool-offset concept.sketch-snaps tool-line sketch',
  'help.toolConvert.summary': '把模型的邊或面的外框轉進草圖，成為跟著模型走的圖元。',
  'help.toolConvert.body': '在面上畫草圖時按這個指令，再點模型的邊或面：邊的投影成為圖元；面會轉成它的外框與孔。這些圖元是紫色的，位置由模型決定，模型改了它們跟著動；邊不見了草圖會報「遺失參考」。\n\n也可以不按這個指令，直接把游標移到模型的邊上畫，見「草圖的吸附與推斷」。',
  'help.toolConvert.see': 'concept.sketch-snaps tool-pierce',
  'help.toolPierce.summary': '在模型的一條垂直邊穿過草圖面的位置放一個點。',

  'help.toolPierce.body':
    '在模型的一條垂直於草圖面的邊穿過草圖面的位置放一個點。\n\n- 按這個指令，再在圖面點一條穿過草圖面的直線邊線；穿過的位置多一個點。\n- 這個點是跟著模型走的參考，模型改了它跟著動；邊不見了草圖會報「遺失參考」。\n- 用來找出孔軸、柱子的中心線與草圖面相交的位置。',

  'help.toolPierce.keywords': '穿透點 穿過 垂直邊 參考 孔軸',

  'help.toolPierce.see': 'tool-convert concept.sketch-snaps hole',

  // ---------------------------------------------------------------- edit and view
  'help.undo.summary': '復原上一個修改。',

  'help.undo.body':
    '復原上一個修改。\n\n- 快速鍵 Ctrl+Z；每個分頁都看得到「復原」按鈕（灰色表示沒有可以退的）。\n- 每個指令是一個復原步驟：一個特徵、一個草圖操作（圓角、修剪、鏡射…）、一次移動零組件都是一步。',

  'help.undo.keywords': '復原 上一步 Ctrl+Z',

  'help.undo.see': 'redo rebuild shortcuts',
  'help.redo.summary': '重做剛復原的修改。',

  'help.redo.body':
    '重做剛復原的修改。\n\n- 快速鍵 Ctrl+Y；每個分頁都看得到「重做」按鈕（灰色表示沒有可以重做的）。',

  'help.redo.keywords': '重做 Ctrl+Y',

  'help.redo.see': 'undo rebuild shortcuts',
  'help.rebuild.summary': '重新計算整個零件。',

  'help.rebuild.body':
    '重新計算整個零件：每個特徵依序再算一遍。\n\n- 平常每次修改後會自動重算，這個指令是要強制再算一次時用。\n- 算不出來的特徵，設計樹那一列變紅，最下方寫「N 個錯誤」，在那一列按右鍵 →「錯誤為何？」會說明原因。',

  'help.rebuild.keywords': '重建 重新計算 錯誤',

  'help.rebuild.see': 'undo concept.feature-tree',
  'help.fit.summary': '調整視角，讓整個模型都看得到。',


  'help.fit.keywords': '全部顯示 縮放 視角 顯示全部',

  'help.fit.see': 'view-iso view-front concept.overview',
  'help.viewFront.summary': '切換成前視。',

  'help.viewFront.body':
    '切換成前視：從正面看，是正交視圖（沒有透視）。\n\n- 也可以點 3D 視窗右上角視角方塊的「前」面。\n- 按住滑鼠中鍵（滾輪）拖曳可以隨意旋轉，視角方塊跟著轉。',

  'help.viewFront.keywords': '前視 視角 正面',

  'help.viewFront.see': 'view-top view-right view-iso',
  'help.viewTop.summary': '切換成上視。',

  'help.viewTop.body':
    '切換成上視：從上面往下看，是正交視圖（沒有透視）。\n\n- 也可以點視角方塊的「上」面。',

  'help.viewTop.keywords': '上視 視角 俯視',

  'help.viewTop.see': 'view-front view-right view-iso',
  'help.viewRight.summary': '切換成右視。',

  'help.viewRight.body':
    '切換成右視：從右側看，是正交視圖（沒有透視）。\n\n- 也可以點視角方塊的「右」面。',

  'help.viewRight.keywords': '右視 視角 側視',

  'help.viewRight.see': 'view-front view-top view-iso',
  'help.viewIso.summary': '切換成等角視。',

  'help.viewIso.body':
    '切換成等角視：從斜上方看，同時看得到三個面。\n\n- 做特徵時常用它檢查形狀；在面上畫草圖前，也用它先看清楚要點哪個面。\n- 沿用正交投影，沒有透視。',

  'help.viewIso.keywords': '等角 視角 立體',

  'help.viewIso.see': 'view-front view-top fit',
  'help.viewNormal.summary': '正視於：轉到垂直看編輯中的草圖面。',

  'help.viewNormal.body':
    '正視於：把視角轉到垂直看編輯中的草圖面。\n\n- 畫草圖時用它，圖元就不會因為斜視而變形。',

  'help.viewNormal.keywords': '正視於 草圖面 垂直 視角',

  'help.viewNormal.see': 'sketch view-front fit',
} as const;
