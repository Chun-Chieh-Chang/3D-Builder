# 開發文件導覽與單一來源

每種資訊只有一個目前維護來源；其他文件用連結引用。歷史數字有日期才有意義，不能把「有案例通過」等同「本版全量通過」。

| 資訊 | 唯一維護來源 | 更新方式 |
|---|---|---|
| 目前能力、限制與待辦 | [產品現況](project-state.md) | 實作／驗證改變時更新 |
| 目前接手與這一批工作 | [handoff](../handoff.md) | 保持短；交付細節進DEV_LOG |
| 安裝、開發、跨平台與驗證命令 | [開發操作](development.md) | 與package.json／設定一起改 |
| Schema、工作區、指令、腳本／手冊數、文件分類、鎖定npm依賴 | [自動盤點](repository-inventory.md) | 改程式來源後執行`npm run docs:sync` |
| 功能範圍與模組原則 | [藍圖](blueprint.md)、[ADR0001](adr/0001-ssot-mece-rules.md) | 範圍變更寫ADR，不改造歷史驗收 |
| 架構決策與當次驗證邊界 | [ADR目錄](adr/) | 保留日期；新證據以補充修正 |
| 交付與失敗分析 | [DEV_LOG](../DEV_LOG.md) | 按日期新增，不維護第二份現況表 |
| 手工清單／說明連結 | [驗證手冊](manual-verification.html)、[help-links.json](help-links.json) | 使用既有同步測試，不複製help內文 |
| 外部應用程式驗收方式 | [自動驗收](automated-acceptance.md) | 證據與未驗目標分開 |
| 授權義務 | [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) | 歷史審閱與目前lock資料分開 |
| 清理處置與保留理由 | [清理紀錄](cleanup-candidates.md) | 先證明引用／初始化／授權責任，再移除 |

所有Markdown（包括測試資料、桌面版與研究證據）的完整清單與唯一主要角色，由[自動盤點](repository-inventory.md)列出。沒有本地`wiki/`，不臆造遠端wiki已同步。若日後新增，必須先選擇唯一維護來源與同步機制。

歷史階段計畫和archive保留當時語意；提案不代表已上線。唯一主要角色不禁止相互引用，也不將同一項交付再抄成另一份驗收真值。`npm run lint:repo`檢查分類、路徑大小寫、壞連結及衍生盤點是否過時。
