/** subassembly: sub-assemblies and the flags of a component (C15.4, C15.5). */
export const subassembly = {
  'subassembly.pathNeedsComponent': '組合件本身的基準面與原點沒有零組件路徑',
  'subassembly.badPath': '結合元素在次組合件內的零組件路徑無效',
  'subassembly.cycle': '這樣組合件會包含它自己：{chain}',
  'subassembly.selfReference': '組合件不能把自己當成零組件：{file}',
  'subassembly.notLoaded': '{what}的零件沒有載入',
  'subassembly.pathOnPart': '{what}：這個零組件是零件，不是次組合件，沒有路徑可走',
  'subassembly.noComponent': '{what}：次組合件裡找不到零組件 {id}',
} as const;
