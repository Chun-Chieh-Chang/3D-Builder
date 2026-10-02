/** subassembly: sub-assemblies and the flags of a component (C15.4, C15.5). */
export const subassembly = {
  'subassembly.pathNeedsComponent': '組合件本身的基準面與原點沒有零組件路徑',
  'subassembly.badPath': '結合元素在次組合件內的零組件路徑無效',
  'subassembly.cycle': '這樣組合件會包含它自己：{chain}',
  'subassembly.selfReference': '組合件不能把自己當成零組件：{file}',
  'subassembly.pathSeparator': '／',
  'subassembly.open': '開啟次組合件',
  'subassembly.insideTip': '次組合件裡的零件：在這裡不能單獨移動，要改請開啟次組合件',
  'subassembly.notAssembly': '「{path}」不是組合件',
  'subassembly.stillLoading': '次組合件還在載入，請稍候',
  'subassembly.stepNotYet': '含次組合件的組合件還不能輸出 STEP',
  'subassembly.nestedProblem': '次組合件用到的檔案無法使用：「{path}」（{why}）；要修復請開啟那個次組合件',
  'subassembly.notLoaded': '{what}的零件沒有載入',
  'subassembly.pathOnPart': '{what}：這個零組件是零件，不是次組合件，沒有路徑可走',
  'subassembly.noComponent': '{what}：次組合件裡找不到零組件 {id}',
} as const;
