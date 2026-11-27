# 網格開邊檢查的量測（2026-11-26）

為 `part_verify_against_2d` 的開邊檢查（`apps/mcp/src/verify2d.ts` 的 `openMeshEdges`）所做的量測與突變。

| 檔案 | 做什麼 | 輸出 |
|---|---|---|
| `open-edges.test.ts` | 32 個好零件與 ADR 0214 有洞的圓角，各自的開邊數 | `data/open-edges.json` |
| `mutate.mjs` | 5 項突變，每項都必須讓 `apps/mcp/test/verify2d.test.ts` 轉紅；比對須恰好一次，跑完逐位元組還原 | — |

執行：

```
npx vitest run -c spikes/mesh-open-edges/vitest.mts
node spikes/mesh-open-edges/mutate.mjs
```
