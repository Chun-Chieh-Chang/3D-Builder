/** asmtriad: 以座標軸移動（Move with Triad, ADR 0179）: the triad's handles, its steps, its menus, and why a value cannot be used. */
export const asmtriad = {
  'act.moveWithTriad': '以座標軸移動',
  'triad.hint': '拖曳箭頭沿軸移動，拖曳方塊在平面內移動，拖曳圓環繞軸旋轉；在圓環上按右鍵可旋轉 90°／180°，在中心球上按右鍵可輸入座標。按 Esc 結束。',
  'triad.steps': '座標軸的步進',
  'triad.moveStep': '移動步進（mm，0 不貼齊）',
  'triad.turnStep': '旋轉步進（°，0 不貼齊）',
  'triad.moveStepInvalid': '移動步進必須是 0 或正的有限數字（mm）',
  'triad.turnStepInvalid': '旋轉步進必須是 0 或正的有限數字（度）',
  'triad.turn': '繞 {axis} 軸旋轉 {angle}°',
  'triad.moveTo': '移至 XYZ 座標…',
  'triad.pickComponent': '請先選擇要移動的零組件（在圖面或設計樹中點選）',
  'triad.limited': '「{name}」受結合限制，不能這樣移動',
  'triad.failed': '移動失敗：{why}',
  'triad.close': '結束座標軸移動',
} as const;
