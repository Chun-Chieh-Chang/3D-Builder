/** stepasm: importing an assembly from a STEP file (F2.8). */
export const stepasm = {
  'stepasm.unreadable': '這個 STEP 檔讀不進來',
  'stepasm.noShapes': 'STEP 檔裡沒有任何形狀',
  'stepasm.notRigid': '零組件「{name}」的位置含有鏡射或縮放，不是剛體位置，無法輸入',
  'stepasm.folderParts': '零件',
  'stepasm.folderSubs': '組件',
  'stepasm.unnamed': '未命名{n}',
  'stepasm.emptyAssembly': '組合件「{name}」沒有任何零組件',
  'stepasm.failedWhy': 'STEP 讀取失敗：{why}',
} as const;