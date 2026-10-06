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

  // ---------------------------------------------------------------- file
  'help.newPart.summary': '開始一個空白零件，附前、上、右三個預設基準面。',
  'help.newPartTemplate.summary': '從範本開始新零件，範本先選好材質與文件設定（空白、碳鋼、鋁件、塑膠件、CNS 製圖）。',
  'help.newAssembly.summary': '開始一個空白組合件，之後插入零組件並加結合。',
  'help.newDemo.summary': '開啟一個示範零件，用來看各種特徵的樣子。',
  'help.open.summary': '開啟零件（.3dbx）或組合件（.3dba）檔案。',
  'help.save.summary': '儲存目前的檔案；還沒有檔名時會問存在哪裡。',
  'help.saveAs.summary': '用新的檔名或位置儲存；組合件另存時會改寫零件的相對路徑。',
  'help.exportStep.summary': '把零件或組合件輸出成 STEP 檔，可以給別的 CAD 開啟。',
  'help.exportStl.summary': '把零件的實體輸出成 STL（三角網格）檔，精細度依文件的網格品質設定。',
  'help.exportImage.summary': '把圖形區現在看到的畫面存成 PNG 圖片。',
  'help.newDrawing.summary': '為已儲存的零件或組合件建立工程圖（檔案有未儲存的修改時不能用）。',
  'help.generateAssembly.summary': '為零件的每個本體各寫一個衍生零件檔，再產生用它們組成的組合件（要先儲存零件）。',
  'help.importStepAssembly.summary': '把 STEP 組合件讀進來，拆成零件檔與組合件。',
  'help.returnAssembly.summary': '從編輯中的零件回到開啟它的組合件。',

  // ---------------------------------------------------------------- tools
  'help.equations.summary': '定義全域變數與運算式，尺寸和特徵數值可以引用它們。',
  'help.appearance.summary': '為零件、本體、特徵或面指定顏色；優先順序是面 ＞ 特徵 ＞ 本體 ＞ 零件。',
  'help.options.summary': '系統選項：介面語言、自動存檔、「新零件」用的範本、開始時可點選的元素；存在這個瀏覽器，不屬於零件檔。',
  'help.shortcuts.summary': '查看與自訂每個指令的快速鍵。',
  'help.measurePart.summary': '量測零件上選取的點、邊、面之間的距離與角度；再按一次結束。',
  'help.draftAnalysis.summary': '分析各面相對脫模方向的拔模角，並在圖形區上色。',
  'help.undercutAnalysis.summary': '找出沿脫模方向兩端都被擋住的面（底切）。',
  'help.thicknessAnalysis.summary': '沿內法向量測各面的壁厚，標出最薄與最厚的地方。',
  'help.checkPart.summary': '檢查模型幾何：是否通過有效性檢查、外殼是否封閉（有沒有開放邊）、體積是否為正。',
  'help.physicalPart.summary': '設定材質並計算質量、重心與慣性矩。',
  'help.properties.summary': '編輯檔案屬性（料號、廠商、說明等），零件表會讀它。',

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
  'help.sweep.summary': '把一張輪廓草圖沿另一張草圖畫的路徑掃出，加到零件上。',
  'help.loft.summary': '在兩張以上的輪廓草圖之間做出漸變的形狀，加到零件上。',
  'help.rib.summary': '用草圖畫的肋線，長出指定厚度的加強肋，可選在線的中間或某一側。',
  'help.extrudeCut.summary': '把選取的草圖沿垂直方向拉出，從零件上切除。',
  'help.revolveCut.summary': '把草圖繞一條中心線旋轉，從零件上切除。',
  'help.sweepCut.summary': '把輪廓沿路徑掃出，從零件上切除。',
  'help.loftCut.summary': '在兩張以上的輪廓之間做出漸變的形狀，從零件上切除。',
  'help.fillet.summary': '把選取的邊或面（面的所有邊）倒成圓角。',
  'help.fillet.body':
    '在圖形區點要倒圓角的邊線或面（可連續點多個），在面板輸入半徑，按 ✔。點已選的會取消它。\n\n- 選邊線：只倒那一條邊（與它相切連續的邊一起）。\n- 選面：倒那個面的所有邊線，包括孔的邊；相切連續的邊與圓柱的接縫不處理。面之後多出來的邊（例如在那個面上又切了一個槽）也會倒，因為每次重新計算都是由面算出它的邊。\n- 兩者可以一起用，同一條邊只倒一次。\n- 選的面沒有任何可以倒的邊時，特徵出錯並說明原因。\n\n「圓角種類」選「面圓角」：不選邊線，改選兩組面（面組 1 與面組 2，先點選要放進的那一組，再在圖面點面）；兩組面相接的邊倒圓角，凸邊去料、凹邊（例如 L 形的內角）補料。兩組面沒有共同的邊時，特徵出錯並說明（不相鄰的面之間的圓角還沒做）。\n\n「完整圓角」：選兩個邊側面組與一個中央面（先點選要放進的那一組，再在圖面點面）；中央面被與兩側面相切的半圓柱面取代，半徑是兩個側面距離的一半，不用輸入。兩個側面要互相平行並垂直於中央面，中央面要是長方形，側面不能比半徑矮；不符合時特徵出錯並說明。新的圓柱面沿用中央面的名稱。\n\n驗證過的例子：40 × 30 × 12 的方塊，選頂面、半徑 2：14282.89 mm³（與選頂面的 4 條邊相同，頂點是斜接）；選頂面與底面：14165.78；圓柱頂面半徑 1.5 的圓角與手算相同；面圓角：頂面與一個側面（長 30 的邊）半徑 2 是 14374.25，L 形內角半徑 3 補上 77.26；完整圓角：40 × 30 × 20 的方塊，頂面夾在前後兩面之間：20137.17 mm³（半徑 15）。',
  'help.chamfer.summary': '把選取的邊或面（面的所有邊）倒成斜角。',
  'help.chamfer.body':
    '選要導角的邊線或面，選「角度-距離」或「距離-距離」，輸入數值，按 ✔。\n\n- 選面時，第一個距離量在你選的那個面上（第二個距離量在邊另一側的面上）；勾「反轉方向」則對調。例如選頂面、距離 3 與 1：頂面縮 3、側面往下切 1；反轉後頂面縮 1、側面切 3。\n- 選邊線時，第一個距離量在名稱排序較前的相鄰面（勾「反轉方向」換另一面）。\n- 選面倒的是它所有的邊線，相切連續的邊與接縫不處理，面之後多出來的邊也會倒。\n\n驗證過的例子：40 × 30 × 12 的方塊，頂面導角 2 × 2：14130.67 mm³。',
  'help.deleteFace.summary': '刪掉選取的面，並把相鄰的面延伸到相接，常用來去掉孔或圓角。',
  'help.hole.summary': '在草圖的點上鑽孔：直孔、沉頭孔、錐孔（countersink）、螺紋孔或定位銷孔，孔徑與深度在面板設定。',
  'help.screwBoss.summary': '在草圖的點上長出帶孔的螺柱，可加拔模與肋。',
  'help.baseFlange.summary': '以草圖建立鈑金的基材：封閉輪廓是平板，開放折線是折過的板。',
  'help.edgeFlange.summary': '在鈑金板的一條邊上折出凸緣，可設長度、角度與折彎半徑。',
  'help.hem.summary': '把鈑金板的邊折回成摺邊（180° 折彎）。',
  'help.flatPattern.summary': '算出鈑金的平板型式（展開圖）、折彎線與折彎表，可輸出 DXF。',
  'help.snapHook.summary': '在塑膠件上做懸臂樑加楔形鉤的卡榫。',
  'help.snapCatch.summary': '在塑膠件上做供卡榫扣住的矩形窗。',
  'help.vent.summary': '在塑膠件的面上做一排排氣槽。',
  'help.draft.summary': '讓選取的面相對中立面傾斜一個脫模角度。',
  'help.draft.body':
    '點選中立面（先選），再點要拔模的面，輸入「拔模角度」，按 ✔。從中立面往外，側壁預設往中立面方向收窄；勾「反轉拔模方向」則離中立面越遠越寬。\n\n驗證過的例子：20 × 10 × 10 的方塊，頂面當中立面、四個側面拔 3°，體積約 1846.44 mm³；反轉後約 2160.89 mm³。三個側面要轉動視角才點得到。',
  'help.draft.keywords': '拔模 脫模 中立面 角度',
  'help.shell.summary': '把實體挖空成薄壁，移除你選的面當開口。',
  'help.shell.body':
    '點要移除的面，輸入「壁厚」，按 ✔（編輯時畫面是薄殼之前的模型，按 ✔ 才看得到結果）。\n\n- 預設往內加厚；勾「向外加厚」改往外。\n- 「壁厚不同的面」可以讓個別的平面壁有不同的厚度。\n- 壁厚大過形狀允許的（例如大於方塊邊長的一半）時特徵會出錯，訊息是「壁厚大於這個形狀允許的…」，改小就恢復。\n\n驗證過的例子：40 × 30 × 10 的方塊，頂面開口、壁厚 2 向內：4512 mm³；向外：5952 mm³。',
  'help.shell.keywords': '薄殼 抽殼 壁厚 開口 向外加厚',
  'help.moveFace.summary': '把選取的平面推動一段距離，周圍的面跟著延伸，用來直接修改匯入的模型。',
  'help.offsetSurface.summary': '把選取的面偏移一段距離，做成曲面本體。',
  'help.splitLine.summary': '把草圖的封閉外圈投影到面上，把面切成區域。',
  'help.knit.summary': '把數個曲面縫成一個曲面本體或實體。',
  'help.fillSurface.summary': '用一圈邊界補出一個曲面。',
  'help.flatSurface.summary': '用一圈封閉的邊補出一個平坦曲面。',
  'help.trimSurface.summary': '用草圖在曲面上切出區域，保留其中一側。',
  'help.extendSurface.summary': '把曲面本體的邊延伸一段距離。',
  'help.thicken.summary': '把曲面本體加厚成實體。',
  'help.cutWithSurface.summary': '用曲面當刀具，從實體切除一側。',
  'help.lipGroove.summary': '在塑膠件的面上依外輪廓做出唇或溝槽，讓上下蓋扣合。',
  'help.combine.summary': '把本體相加、相減（主要本體減去工具本體）或取交集。',
  'help.linearPattern.summary': '沿一個或兩個方向複製排列所選的特徵。',
  'help.circularPattern.summary': '繞一條軸複製排列所選的特徵。',
  'help.mirror.summary': '以一個平面為鏡面，鏡射所選的特徵或本體。',
  'help.refPlane.summary': '建立參考用的基準面（偏移、角度、三點、平行等）。',
  'help.refAxis.summary': '建立參考用的基準軸。',
  'help.refPoint.summary': '建立參考用的點。',
  'help.coordSys.summary': '建立座標系統，輸出 STEP 時可以用來定位。',
  'help.importStep.summary': '把 STEP 檔讀進來成為零件的本體，必要時自動修復。',

  // ---------------------------------------------------------------- assembly
  'help.insertComponent.summary': '把零件檔插入組合件，成為零組件。',
  'help.mate.summary': '用結合限制零組件之間的位置關係（重合、平行、同心、距離…）。',
  'help.moveComponent.summary': '用拖曳或輸入數值移動零組件。',
  'help.rotateComponent.summary': '旋轉零組件。',
  'help.explode.summary': '建立爆炸視圖：把零組件沿方向分開，只是顯示，不改變組裝位置。',
  'help.measureAssembly.summary': '量測組合件中選取元素之間的距離與角度。',
  'help.clearance.summary': '檢查零組件之間的最小間隙是否夠。',
  'help.interference.summary': '找出零組件之間重疊的體積（接觸不算）。',
  'help.interference.body':
    '「組合件」→「干涉檢查」：視窗列出共用體積的每一組零組件與重疊的體積，3D 視窗裡重疊的部分是紅色；在表格點一組，只顯示那兩個零組件，再點一次全部顯示。\n\n- 預設以頂層零組件為單位：子組合件算一個，陣列與鏡射的每個複製品各算一個。\n- 勾選「也檢查子組合件裡面的零件」，每個零件各算一個，子組合件裡面的零件也會互相比；名稱寫成「子組合件 › 零件」，同一個子組合件裡同名的零件以 <2>、<3> 分開。\n- 只有接觸不算干涉，重疊體積小於 0.001 mm³ 的也不報。隱藏的零組件會檢查，被抑制的不會。模型改變後視窗會說「模型已經變更」，按「重新檢查」。\n\n驗證過的例子：金樣夾具的兩個子組合件，各有一片定位板與兩根削邊銷，銷柄（半徑 5）放在板的孔（半徑 4）裡：勾選後 4 組，每組約 405.4 mm³，合計 1621.6；不勾選沒有干涉。',
  'help.interference.keywords': '干涉 重疊 碰撞 子組合件 子組合件內部 體積',
  'help.checkAssembly.summary': '檢查組合件的幾何是否有效。',
  'help.physicalAssembly.summary': '計算組合件的質量、重心與慣性矩。',
  'help.bom.summary': '產生零件表（數量、料號、廠商），可輸出 CSV。',
  'help.patternLinear.summary': '沿方向複製排列零組件。',
  'help.patternCircular.summary': '繞軸複製排列零組件。',
  'help.mirrorComponent.summary': '鏡射零組件。',
  'help.fixComponent.summary': '把零組件固定在目前的位置，不受結合影響。',
  'help.floatComponent.summary': '讓固定的零組件可以被結合與拖曳移動。',

  // ---------------------------------------------------------------- sketch
  'help.construction.summary': '把選取的圖元切換成幾何建構線（虛線，不參與輪廓）。',
  'help.exitSketch.summary': '離開草圖並儲存修改，回到特徵設計。',
  'help.exitSketch.see': 'sketch',
  'help.toolLine.summary': '畫直線：按一下設起點，再按一下設終點，可連續畫，Esc 或按兩下結束。',
  'help.toolLine.body':
    '- 起點可以吸到草圖的點、原點、模型的邊與頂點；游標旁會顯示是什麼（重合、中點、模型端點…）。\n- 接近水平或垂直（3° 內）自動加水平或垂直關係；方向接近另一條線時自動加共線、平行或互相垂直；從圓弧端點沿切線畫加相切。\n- 與其他草圖點水平或垂直對齊（5 像素內）時，出現灰色虛線並加對齊關係。\n- 畫回第一個點會封閉並結束連續畫線。',
  'help.toolLine.see': 'concept.sketch-snaps',
  'help.toolCenterline.summary': '畫中心線（幾何建構線），可當旋轉軸或鏡射線。',
  'help.toolRect.summary': '用兩個對角畫矩形，四邊自動加水平與垂直關係。',
  'help.toolCenterRect.summary': '用中心與一個角落畫矩形。',
  'help.toolCircle.summary': '畫圓：按一下設圓心，再按一下設半徑。',
  'help.toolPerimeterCircle.summary': '用圓周上的三個點畫圓。',
  'help.toolArc.summary': '用圓心、起點、終點畫圓弧。',
  'help.toolTangentArc.summary': '從直線或圓弧的端點畫相切的圓弧。',
  'help.toolThreePointArc.summary': '用起點、終點與弧上一點畫圓弧。',
  'help.toolPoint.summary': '放置一個點。',
  'help.toolDimension.summary': '標註尺寸：選一或兩個圖元，再點一下放置，輸入數值按 Enter。',
  'help.toolDimension.body': '- 選一條線標長度；選圓標直徑、選圓弧標半徑（弧長用面板的「標註弧長」）；選兩條線標角度；選兩點標距離。\n- 多餘的尺寸（會讓草圖過多定義的）會變成從動尺寸，顯示成灰色斜體加括號，只顯示量到的值，面板的尺寸清單可以切換「設為從動／設為驅動」。\n- 雙擊尺寸可以改數值，數值欄可以輸入運算式或方程式的變數。',
  'help.toolSlot.summary': '用兩個圓心與寬度畫長圓孔輪廓。',
  'help.toolPolygon.summary': '畫正多邊形，邊數與內切／外接在面板設定。',
  'help.toolSketchFillet.summary': '把兩條線的角落倒成圓角（草圖圓角）。',
  'help.toolSketchChamfer.summary': '把兩條線的角落倒成斜角（草圖導角）。',
  'help.toolTrim.summary': '修剪：點線上被交點切出的一段，把它去掉。',
  'help.toolExtend.summary': '延伸：點線的一端，延伸到擋住它的線。',
  'help.toolOffset.summary': '把選取的圖元向一側偏移一個距離。',
  'help.toolOffset.body': '先選取要偏移的線，再按這個指令；左邊面板有「偏移距離」。沒有選取就按時，面板最上方會提示先選取。',
  'help.toolMirror.summary': '以一條線為鏡像軸，鏡射選取的圖元。',
  'help.toolConvert.summary': '把模型的邊或面的外框轉進草圖，成為跟著模型走的圖元。',
  'help.toolConvert.body': '在面上畫草圖時按這個指令，再點模型的邊或面：邊的投影成為圖元；面會轉成它的外框與孔。這些圖元是紫色的，位置由模型決定，模型改了它們跟著動；邊不見了草圖會報「遺失參考」。\n\n也可以不按這個指令，直接把游標移到模型的邊上畫，見「草圖的吸附與推斷」。',
  'help.toolConvert.see': 'concept.sketch-snaps tool-pierce',
  'help.toolPierce.summary': '在模型的一條垂直邊穿過草圖面的位置放一個點。',

  // ---------------------------------------------------------------- edit and view
  'help.undo.summary': '復原上一個修改。',
  'help.redo.summary': '重做剛復原的修改。',
  'help.rebuild.summary': '重新計算整個零件。',
  'help.fit.summary': '調整視角，讓整個模型都看得到。',
  'help.viewFront.summary': '切換成前視。',
  'help.viewTop.summary': '切換成上視。',
  'help.viewRight.summary': '切換成右視。',
  'help.viewIso.summary': '切換成等角視。',
  'help.viewNormal.summary': '正視於：轉到垂直看編輯中的草圖面。',
} as const;
