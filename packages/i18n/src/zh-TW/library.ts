/** library: the standard parts library (F6.1). */
export const library = {
  'library.kind.setScrew': '內六角止付螺絲（凹端）',
  'library.kind.socketScrew': '內六角螺絲',
  'library.kind.dowelPin': '圓柱定位銷',
  'library.kind.washer': '平墊圈',
  'library.folder': '標準件',
  'library.title': '標準件圖庫',
  'library.kind': '種類',
  'library.size': '規格',
  'library.length': '長度',
  'library.add': '做出並選取',
  'library.hint': '零件檔會做在專案資料夾的「標準件」裡（尺寸是變數，之後還能改）；廠商的 STEP 檔放在專案資料夾裡，就會出現在上面的清單。',
  'library.made': '已做出標準件 {name}',
  'library.failed': '無法做出標準件：{why}',
  'library.badSize': '沒有這個規格：{kind} {size}',
  'library.badLength': '長度必須是正數：{length}',
} as const;
