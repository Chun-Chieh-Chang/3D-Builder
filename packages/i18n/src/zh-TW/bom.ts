/** bom: the parts list of an assembly (C15.16). */
export const bom = {
  'bom.title': '零件表',
  'bom.item': '項次',
  'bom.name': '名稱',
  'bom.qty': '數量',
  'bom.vendor': '廠商',
  'bom.partNo': '料號',
  'bom.file': '檔案',
  'bom.fileSuffix': '-零件表',
  'bom.flat': '只列零件',
  'bom.indented': '縮排（含次組合件）',
  'bom.exportCsv': '輸出 CSV',
  'bom.empty': '組合件裡沒有零組件。',
  'bom.hint': '被抑制的零組件不列，隱藏的要列；複製排列的實例與鏡射件都算在數量裡。廠商與料號取自零件檔「檔案屬性」裡的自訂屬性「廠商」「料號」。',
  'bom.act': '零件表…',
  'bom.total': '共 {rows} 列，{qty} 個零件',
} as const;