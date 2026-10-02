/** stepasm: importing an assembly from a STEP file (F2.8). */
export const stepasm = {
  'stepasm.unreadable': '這個 STEP 檔讀不進來',
  'stepasm.noShapes': 'STEP 檔裡沒有任何形狀',
  'stepasm.notRigid': '零組件「{name}」的位置含有鏡射或縮放，不是剛體位置，無法輸入',
  'stepasm.act': '輸入 STEP 組合件…',
  'stepasm.reading': '正在讀取「{name}」的組合件結構…',
  'stepasm.askFolder': '「{name}」有 {parts} 個零件、{subs} 個次組合件。要把它們寫成零件檔與組合件檔，請選一個資料夾來放（建議選空的資料夾；裡面已有的檔案不會被動到）。',
  'stepasm.folderHint': '這個資料夾會被寫入，瀏覽器會問你是否允許編輯它；輸入完成後它就是專案資料夾。',
  'stepasm.done': '已輸入「{name}」：{parts} 個零件檔、{subs} 個次組合件，寫在「{folder}」',
  'stepasm.failed': '輸入 STEP 組合件失敗：{why}',
  'stepasm.folderParts': '零件',
  'stepasm.folderSubs': '組件',
  'stepasm.unnamed': '未命名{n}',
  'stepasm.emptyAssembly': '組合件「{name}」沒有任何零組件',
  'stepasm.failedWhy': 'STEP 讀取失敗：{why}',
} as const;