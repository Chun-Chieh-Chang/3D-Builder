/** patterns: component patterns and mirrors in an assembly (C15.13). */
export const patterns = {
  'pattern.noPlane': '請選擇鏡射面',
  'pattern.badKind': '不明的排列類型：{kind}',
  'pattern.noAxis': '請選擇排列的方向或旋轉軸',
  'pattern.badCount': '實例數必須是 2 以上的整數',
  'pattern.circularOneAxis': '環狀排列只有一個旋轉軸',
  'pattern.tooMany': '一個排列最多 {max} 個實例',
  'pattern.badSpacing': '間距或角度必須大於 0',
  'pattern.badSkip': '沒有這個實例可以跳過：「{label}」',
  'pattern.derivedNoMate': '排列與鏡射的實例是跟著種子的衍生零件，不能當結合的對象；請選種子上的元素',
  'pattern.axisNotFound': '找不到排列的方向或旋轉軸（它的零組件或元素已不在）',
  'pattern.noSeed': '找不到排列的種子零組件：{id}',
  'pattern.nameEmpty': '名稱不可空白',
  'pattern.idInUse': 'ID 已被使用：{id}',
  'pattern.notFound': '找不到排列：{id}',
  'pattern.seedLeftOut': '種子「{name}」已抑制，排列的實例也不存在',
} as const;
