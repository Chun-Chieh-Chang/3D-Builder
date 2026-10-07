/** viewport: wording of the app that used to be in the code (D9.1). */
export const viewport = {
  'pick.edges': '點選邊線以加入{what}',
  'pick.filletGroups': '點選面，加進左邊面板目前選著的那一組（再點一次已選的面就取消）',
  'pick.edgesOrFaces': '點選邊線或面以加入{what}（選面＝它的所有邊線）',
  'sketch.exitKeep': '離開草圖（保留變更）',
  'sketch.pictureFailed': '加入圖片失敗：{why}',
  'sketch.pictureNotImage': '「{name}」不是 PNG 或 JPEG 圖片（草圖圖片只收這兩種）',
  'sketch.pictureScaleBad': '兩個點不能是同一點，實際距離要大於 0',
  'sketch.exitDiscard': '放棄變更並離開草圖',
  'boot.failed': '幾何核心載入失敗：{why}',
  'boot.loading': '正在載入幾何核心（OCCT WASM，約 43 MB）…',
  'hover.name': '持久名稱：',
  'hover.face': '面：',
  'hover.selected': '已選取面',
  'hover.selectedElements': '已選取 {n} 個邊線／頂點（Ctrl 或 Shift 加選；再按圓角、導角等指令會直接帶進去）：',
  'hover.canSketch': '：按「草圖」分頁的「草圖」即可在此面上繪製。',
  'hover.notPlanar': '（不是平面，不能放草圖）',
} as const;
