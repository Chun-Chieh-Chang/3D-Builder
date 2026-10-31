# 儲存庫盤點（自動產生）

> 由 `npm run docs:sync` 從程式與工作區設定衍生；請勿手改。`npm run lint:repo` 會比對。數量不代表本版全部驗證通過。

## 程式事實

| 項目 | 程式來源值 |
|---|---|
| 零件／組合件／工程圖 Schema | 86／7／34 |
| ADR 文件 | 219 |
| 瀏覽器檔案／可執行腳本／呼叫 | 205／201／252 |
| 實機清單項目 | 92 |
| 本地 wiki/ | 不存在；未假定另有遠端 wiki |

## 工作區

| 套件 | 設定來源 |
|---|---|
| @3db/desktop | [apps/desktop/package.json](../apps/desktop/package.json) |
| @3db/web | [apps/web/package.json](../apps/web/package.json) |
| @3db/assembly | [packages/assembly/package.json](../packages/assembly/package.json) |
| @3db/drawing | [packages/drawing/package.json](../packages/drawing/package.json) |
| @3db/i18n | [packages/i18n/package.json](../packages/i18n/package.json) |
| @3db/io | [packages/io/package.json](../packages/io/package.json) |
| @3db/kernel | [packages/kernel/package.json](../packages/kernel/package.json) |
| @3db/library | [packages/library/package.json](../packages/library/package.json) |
| @3db/model | [packages/model/package.json](../packages/model/package.json) |
| @3db/naming | [packages/naming/package.json](../packages/naming/package.json) |
| @3db/regen | [packages/regen/package.json](../packages/regen/package.json) |
| @3db/render | [packages/render/package.json](../packages/render/package.json) |
| @3db/sketch | [packages/sketch/package.json](../packages/sketch/package.json) |

## 開發指令

| npm run | package.json 的實際內容 |
|---|---|
| `dev` | `npm run dev -w @3db/web -- --open` |
| `dev:auto` | `npm run dev:auto -w @3db/web -- --open` |
| `build` | `npm run build -w @3db/web` |
| `typecheck` | `tsc -p tsconfig.json` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `setup:git` | `git config diff.3dbx.textconv "node scripts/3dbx.mjs cat"` |
| `doctor` | `node scripts/doctor.mjs` |
| `make:kit` | `vitest run --config tests/kit/vitest.kit.config.ts` |
| `make:drawing` | `vitest run --config tests/kit/vitest.kit.config.ts drawing-parts` |
| `lint:deps` | `node scripts/check-deps.mjs` |
| `lint:rules` | `node scripts/check-anti-patterns.mjs` |
| `lint:i18n` | `node scripts/check-i18n.mjs` |
| `verify:ui` | `node scripts/verify-ui.mjs` |
| `verify:external-samples` | `vitest run tests/phase7/public-sheet-metal-acceptance.test.ts` |
| `verify:freecad-sheet-metal` | `node scripts/verify-freecad-sheet-metal.mjs` |
| `verify:drawing-export` | `node scripts/verify-drawing-export.mjs` |
| `check:perf` | `node scripts/check-perf.mjs` |
| `check` | `npm run typecheck && npm run lint:rules && npm run lint:deps && npm run lint:i18n && npm run lint:repo && npm test` |
| `docs:sync` | `node scripts/check-repository.mjs --write` |
| `lint:repo` | `node scripts/check-repository.mjs` |
| `audit:repo` | `node scripts/check-repository.mjs --json out/repository-audit.json` |

## 鎖定依賴（含跨平台可選套件）

npm lock條目：116，其中production標記9、development標記107。此處按lockfile記錄，不等同本機安裝數或實際bundle包含數。

Cargo.lock：417個package條目（含本專案）。Rust授權未由lockfile提供，不能套用舊人工掃描結論。

| npm套件 | 鎖定版本 | lockfile授權欄 | 分類 |
|---|---|---|---|
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0 | development |
| @jridgewell/resolve-uri | 3.1.2 | MIT | development |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | development |
| @jridgewell/trace-mapping | 0.3.31 | MIT | development |
| @oxc-project/types | 0.151.0 | MIT | development |
| @rolldown/binding-android-arm-eabi | 1.2.11 | MIT | development／optional |
| @rolldown/binding-android-arm64 | 1.2.11 | MIT | development／optional |
| @rolldown/binding-darwin-arm64 | 1.2.11 | MIT | development／optional |
| @rolldown/binding-darwin-x64 | 1.2.11 | MIT | development／optional |
| @rolldown/binding-freebsd-x64 | 1.2.11 | MIT | development／optional |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.11 | MIT | development／optional |
| @rolldown/binding-linux-arm64-gnu | 1.2.11 | MIT | development／optional |
| @rolldown/binding-linux-arm64-musl | 1.2.11 | MIT | development／optional |
| @rolldown/binding-linux-ppc64-gnu | 1.2.11 | MIT | development／optional |
| @rolldown/binding-linux-s390x-gnu | 1.2.11 | MIT | development／optional |
| @rolldown/binding-linux-x64-gnu | 1.2.11 | MIT | development／optional |
| @rolldown/binding-linux-x64-musl | 1.2.11 | MIT | development／optional |
| @rolldown/binding-openharmony-arm64 | 1.2.11 | MIT | development／optional |
| @rolldown/binding-win32-arm64-msvc | 1.2.11 | MIT | development／optional |
| @rolldown/binding-win32-x64-msvc | 1.2.11 | MIT | development／optional |
| @rolldown/pluginutils | 1.0.1 | MIT | development |
| @salusoft89/planegcs | 1.2.0 | LGPL-2.0-or-later | production |
| @tauri-apps/cli | 2.12.1 | Apache-2.0 OR MIT | development |
| @tauri-apps/cli-darwin-arm64 | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tauri-apps/cli-darwin-x64 | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tauri-apps/cli-linux-arm-gnueabihf | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tauri-apps/cli-linux-arm64-gnu | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tauri-apps/cli-linux-arm64-musl | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tauri-apps/cli-linux-riscv64-gnu | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tauri-apps/cli-linux-x64-gnu | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tauri-apps/cli-linux-x64-musl | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tauri-apps/cli-win32-arm64-msvc | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tauri-apps/cli-win32-ia32-msvc | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tauri-apps/cli-win32-x64-msvc | 2.12.1 | Apache-2.0 OR MIT | development／optional |
| @tweenjs/tween.js | 23.1.3 | MIT | development |
| @types/chai | 5.2.3 | MIT | development |
| @types/deep-eql | 4.0.2 | MIT | development |
| @types/estree | 1.0.9 | MIT | development |
| @types/node | 26.6.3 | MIT | development |
| @types/react | 19.3.0 | MIT | development |
| @types/react-dom | 19.3.0 | MIT | development |
| @types/stats.js | 0.17.4 | MIT | development |
| @types/three | 0.186.0 | MIT | development |
| @types/webxr | 0.5.24 | MIT | development |
| @typescript/typescript-aix-ppc64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-darwin-arm64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-darwin-x64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-freebsd-arm64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-freebsd-x64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-linux-arm | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-linux-arm64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-linux-loong64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-linux-mips64el | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-linux-ppc64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-linux-riscv64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-linux-s390x | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-linux-x64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-netbsd-arm64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-netbsd-x64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-openbsd-arm64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-openbsd-x64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-sunos-x64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-win32-arm64 | 7.0.2 | Apache-2.0 | development／optional |
| @typescript/typescript-win32-x64 | 7.0.2 | Apache-2.0 | development／optional |
| @vitejs/plugin-react | 6.1.1 | MIT | development |
| @vitest/mocker | 5.0.2 | MIT | development |
| @vitest/spy | 5.0.2 | MIT | development |
| assertion-error | 2.0.1 | MIT | development |
| chai | 6.2.2 | MIT | development |
| comlink | 4.4.2 | Apache-2.0 | production |
| csstype | 3.2.3 | MIT | development |
| detect-libc | 2.1.2 | Apache-2.0 | development |
| es-module-lexer | 2.3.2 | MIT | development |
| estree-walker | 3.0.3 | MIT | development |
| expect-type | 1.4.0 | Apache-2.0 | development |
| fdir | 6.5.0 | MIT | development |
| fflate | 0.8.3 | MIT | development |
| fsevents | 2.3.3 | MIT | development／optional |
| immer | 11.1.18 | MIT | production |
| libcascade | 3.0.2 | LGPL-2.1-only WITH Open-CASCADE-Exception-1.0 | production |
| lightningcss | 1.33.0 | MPL-2.0 | development |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 | development／optional |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 | development／optional |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 | development／optional |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 | development／optional |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 | development／optional |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 | development／optional |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 | development／optional |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 | development／optional |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 | development／optional |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 | development／optional |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | development／optional |
| magic-string | 1.4.2 | MIT | development |
| meshoptimizer | 1.1.1 | MIT | development |
| nanoid | 3.3.19 | MIT | development |
| obug | 2.2.1 | MIT | development |
| picocolors | 1.1.1 | ISC | development |
| picomatch | 4.0.7 | MIT | development |
| postcss | 8.5.28 | MIT | development |
| react | 19.3.0 | MIT | production |
| react-dom | 19.3.0 | MIT | production |
| replicad-opencascadejs | 1.1.0 | LGPL-2.1-only | development |
| rolldown | 1.2.11 | MIT | development |
| scheduler | 0.28.0 | MIT | production |
| source-map-js | 1.2.1 | BSD-3-Clause | development |
| std-env | 4.2.0 | MIT | development |
| three | 0.186.1 | MIT | production |
| three-mesh-bvh | 0.9.15 | MIT | production |
| tinybench | 6.2.0 | MIT | development |
| tinyexec | 1.3.1 | MIT | development |
| tinyglobby | 0.2.17 | MIT | development |
| typescript | 7.0.2 | Apache-2.0 | development |
| undici-types | 8.9.0 | MIT | development |
| vite | 8.3.1 | MIT | development |
| vitest | 5.0.2 | MIT | development |
| why-is-node-running | 3.2.2 | MIT | development |

## 文件分類（每份只有一個主要角色）

操作與現況讀 [文件導覽](README.md)；決策、階段計畫與交付歷史的數字屬其記錄時間，不當成當前能力。

### 交付歷史

- [3D-Builder 開發日誌 (DEV_LOG.md)](<../DEV_LOG.md>)
- [六項建議的執行順序（2026-10-24 完成範圍內實作）](<implementation-sequence.md>)

### 交接

- [交接與接續工作 (Handoff for Claude Code)](<../handoff.md>)

### 交接歷史

- [舊交接歷史](<handoff-history.md>)

### 入口

- [3D-Builder](<../README.md>)

### 圖示授權

- [SolidCraft command artwork](<../apps/web/src/icons/solidcraft/README.md>)

### 封存歷史

- [清理歷史：2026-10-07至2026-10-20](<archive/cleanup-through-2026-10-20.md>)
- [交接快照封存：截至2026-10-26](<archive/handoff-through-2026-10-26.md>)

### 工作規則

- [3D-Builder Agent 自我演化與系統防禦規則庫 (AGENTS.md)](<../AGENTS.md>)

### 平台操作

- [3D-Builder 桌面版（Tauri 2）](<../apps/desktop/README.md>)

### 授權

- [第三方授權清單（THIRD_PARTY_NOTICES）](<../THIRD_PARTY_NOTICES.md>)

### 文件導覽

- [開發文件導覽與單一來源](<README.md>)

### 架構決策

- [ADR 0001：程式碼層的 SSOT/MECE 守則](<adr/0001-ssot-mece-rules.md>)
- [ADR 0002：Phase 0 的幾何核心、求解器與實測結果](<adr/0002-phase0-kernel-and-solvers.md>)
- [ADR 0003：OCCT 綁定缺口的技術驗證與決策](<adr/0003-occt-binding-gaps.md>)
- [ADR 0004：草圖編輯（Phase 1A）](<adr/0004-sketch-editing.md>)
- [ADR 0005：特徵與布林（Phase 1B）](<adr/0005-features-and-booleans.md>)
- [ADR 0006：設計樹操作（Phase 1D）](<adr/0006-feature-tree-operations.md>)
- [ADR 0007：基準面（Phase 1C）](<adr/0007-reference-planes.md>)
- [ADR 0008：零件檔 `.3dbx` 與本機檔案（Phase 1E）](<adr/0008-part-file.md>)
- [ADR 0009：STEP 輸入（Phase 1F）](<adr/0009-step-import.md>)
- [ADR 0010：Phase 1 驗收發現的修正（1G）](<adr/0010-phase1-acceptance-fixes.md>)
- [ADR 0011：組合件骨架（2A）](<adr/0011-assembly-skeleton.md>)
- [ADR 0012：結合求解器（2B）](<adr/0012-mate-solver.md>)
- [ADR 0013：結合的介面與管理（2C）](<adr/0013-mate-ui.md>)
- [ADR 0014：移動零組件與參考檔（2D）](<adr/0014-moving-and-reference-files.md>)
- [ADR 0015：STEP 組合件輸出（2E）](<adr/0015-step-assembly-export.md>)
- [ADR 0016：零組件的網格與載入進度（2F 觀察的處理）](<adr/0016-component-mesh-and-load-progress.md>)
- [ADR 0017：Phase 3a-0 技術驗證（進階特徵的演化歷史、移動面、重算時間）](<adr/0017-phase3a-technical-validation.md>)
- [ADR 0018：顯示/隱藏（D4.6）與遺失參考的修復（B4.3）](<adr/0018-visibility-and-reference-repair.md>)
- [ADR 0019：多語系的機制（D9.1）](<adr/0019-i18n-mechanism.md>)
- [ADR 0020：運算式、全域變數與檔案屬性（3a-1）](<adr/0020-expressions-and-variables.md>)
- [ADR 0021：直接編輯與輸入修復（Phase 3a-2：刪除面、移動面、STEP 診斷與縫合）](<adr/0021-direct-editing-and-import-repair.md>)
- [ADR 0022：多本體（Phase 3a-3：本體、合併結果、組合、參考本體、隱藏）](<adr/0022-multiple-bodies.md>)
- [ADR 0023：草圖工具 P1（Phase 3a-4a）——狹槽、多邊形、圓角／導角、修剪／延伸、偏移、鏡射](<adr/0023-sketch-tools-p1.md>)
- [ADR 0024：草圖的 P1 限制條件與從動尺寸（Phase 3a-4b）](<adr/0024-sketch-relations-and-driven-dimensions.md>)
- [ADR 0025：草圖的衝突診斷、檢查與修復、輪廓選取（Phase 3a-4c）](<adr/0025-sketch-diagnosis-check-and-contours.md>)
- [ADR 0026：跟著模型走的草圖圖元——轉換實體引用與貫穿（Phase 3a-4d）](<adr/0026-sketch-entities-that-follow-the-model.md>)
- [ADR 0027：伸長與旋轉的 P1——其他終止型態、方向 2、拔模、薄件（Phase 3a-5a）](<adr/0027-extrude-revolve-p1.md>)
- [ADR 0028：薄殼（Phase 3a-5b）](<adr/0028-shell.md>)
- [ADR 0029：拔模特徵（Phase 3a-5c）](<adr/0029-draft-feature.md>)
- [ADR 0030：異型孔精靈（Phase 3a-6a）](<adr/0030-hole-wizard.md>)
- [ADR 0031：掃出（Phase 3a-6b）](<adr/0031-sweep.md>)
- [ADR 0032：疊層拉伸（Phase 3a-6c）](<adr/0032-loft.md>)
- [ADR 0033：肋材（Phase 3a-6d）](<adr/0033-rib.md>)
- [ADR 0034：參考幾何（Phase 3a-7a）](<adr/0034-reference-geometry.md>)
- [ADR 0035：線性與環狀複製排列（Phase 3a-7b）](<adr/0035-patterns.md>)
- [ADR 0036：鏡射（Phase 3a-7c）](<adr/0036-mirror.md>)
- [ADR 0037：材質、質量與文件設定（Phase 3a-8a）](<adr/0037-material-and-settings.md>)
- [ADR 0038：外觀與顏色（Phase 3a-8b）](<adr/0038-appearance.md>)
- [ADR 0039：輸出 — STL、STEP 選項（AP242、座標系統）、影像（Phase 3a-8c）](<adr/0039-output.md>)
- [ADR 0040：自動存檔與當機復原、文字化格式的工具（Phase 3a-9a）](<adr/0040-autosave-and-text-tools.md>)
- [ADR 0041：設計樹的順序與資料夾與註解、文件範本、快速鍵（Phase 3a-9b）](<adr/0041-tree-order-folders-templates-shortcuts.md>)
- [ADR 0042：顯示類型、視角選擇方塊、剖面視圖（Phase 3a-9c-1）](<adr/0042-view-options.md>)
- [ADR 0043：選取——濾器、選擇其他、迴圈與相切、BVH（Phase 3a-9c-2）](<adr/0043-selection.md>)
- [ADR 0044：系統選項與英文（Phase 3a-9c-3）](<adr/0044-system-options-english.md>)
- [ADR 0045：3a 驗收——不需要樣本的部分與驗收工具（Phase 3a-10）](<adr/0045-acceptance-3a.md>)
- [ADR 0046：Phase 3b-0 技術驗證——鏡射零組件、干涉檢查效能、STEP 組合件結構、桌面版](<adr/0046-phase3b-technical-validation.md>)
- [ADR 0047：剛性次組合件與零組件的隱藏、抑制、透明（Phase 3b-1，**組合件 Schema 3**）](<adr/0047-rigid-sub-assemblies.md>)
- [ADR 0048：零組件的複製排列與鏡射（Phase 3b-2，**組合件 Schema 4**）](<adr/0048-component-patterns-and-mirrors.md>)
- [ADR 0049：STEP 組合件輸入（Phase 3b-3，F2.8，Schema 不變）](<adr/0049-step-assembly-import.md>)
- [ADR 0050：零件表與爆炸視圖（Phase 3b-4，C15.16、C15.14，**組合件 Schema 5**）](<adr/0050-parts-list-and-exploded-view.md>)
- [ADR 0051：評估工具——物質特性、測量、干涉檢查、檢查模型幾何（Phase 3b-5，E1.1、E1.2、E2.1、E3.1）](<adr/0051-evaluation-tools.md>)
- [ADR 0052：桌面版——Tauri 2 包網頁版（Phase 3b-6，F8.1）](<adr/0052-desktop-shell.md>)
- [ADR 0053：3b 驗收——不需要樣本的部分（Phase 3b-7 的 A 段）](<adr/0053-acceptance-3b.md>)
- [ADR 0054：衍生本體與從本體產生組合件（Phase 4a-1，C7.5，零件 Schema 26）](<adr/0054-derived-bodies.md>)
- [ADR 0055：進階結合——限制、寬度、相互對稱（Phase 4a-2，C15.9，組合件 Schema 6）](<adr/0055-advanced-mates.md>)
- [ADR 0056：定位銷孔（Phase 4a-3，C4.8，零件 Schema 27）](<adr/0056-dowel-pin-holes.md>)
- [ADR 0057：標準件圖庫（Phase 4a-4，F6.1，Schema 不變）](<adr/0057-standard-parts-library.md>)
- [ADR 0058：餘隙確認、取放空間與拖曳時的碰撞偵測（Phase 4a-5，E2.2、A3.6，Schema 不變）](<adr/0058-clearance-and-collision.md>)
- [ADR 0059：4a 驗收——不需要樣本的部分（Phase 4a-6 的 A 段）](<adr/0059-acceptance-4a.md>)
- [ADR 0060：工程圖文件與標準視圖（Phase 5-1，C16.1、C16.2，工程圖 Schema 1）](<adr/0060-drawing-document-and-views.md>)
- [ADR 0061：投影、剖面與細部放大視圖（Phase 5-2，C16.3，工程圖 Schema 2）](<adr/0061-derived-drawing-views.md>)
- [ADR 0062：尺寸與公差（Phase 5-3，C16.4，工程圖 Schema 3）](<adr/0062-dimensions.md>)
- [ADR 0063：中心記號與中心線、孔標註、孔表（Phase 5-4a，C16.5、C16.6，工程圖 Schema 4）](<adr/0063-annotations-and-hole-table.md>)
- [ADR 0064：組合件工程圖——零件表與零件號球（Phase 5-4b，C16.6、C15.16，工程圖 Schema 4 不變）](<adr/0064-assembly-drawing.md>)
- [ADR 0065：DXF 與 PDF 輸出（Phase 5-5，F3.1、F3.2）](<adr/0065-dxf-and-pdf-output.md>)
- [ADR 0066：Phase 5 驗收 A 段（不需樣本與檢視器）（5-6）](<adr/0066-acceptance-5.md>)
- [ADR 0067：檢具曲面的技術驗證（4b-0）](<adr/0067-surface-validation.md>)
- [ADR 0068：曲面本體與核心的曲面方法（Phase 4b-1，C9.2–C9.4、C8.1，零件 Schema 28）](<adr/0068-surface-bodies.md>)
- [ADR 0069：分割線特徵（Phase 4b-2，C8.1，零件 Schema 29）](<adr/0069-split-line.md>)
- [ADR 0070：分割線與偏移曲面的介面（Phase 4b-3，C8.1、C9.2）](<adr/0070-gauge-ui.md>)
- [ADR 0071：縫織、填補、平坦、修剪、延伸曲面（Phase 4b-4，C9.2、C9.3，零件 Schema 30）](<adr/0071-surface-editing.md>)
- [ADR 0072：厚面、以曲面除料，與曲面本體的最後幾條規則（Phase 4b-5，C9.4，零件 Schema 31）](<adr/0072-thicken-cut.md>)
- [ADR 0073：Phase 4b 驗收 A 段（4b-6，檢具）](<adr/0073-acceptance-4b.md>)
- [ADR 0074：塑膠件的技術驗證（Phase 6-0，E3.2、E3.3、E3.5、C5.4、C4.11）](<adr/0074-plastic-validation.md>)
- [ADR 0075：拔模分析（Phase 6-1，E3.2）](<adr/0075-draft-analysis.md>)
- [ADR 0076：底切分析（Phase 6-2，E3.3）](<adr/0076-undercut-analysis.md>)
- [ADR 0077：厚度分析（Phase 6-3，E3.5），與兩個射線分析共用的取樣](<adr/0077-thickness-analysis.md>)
- [ADR 0078：不等殼厚（Phase 6-4，C5.4，零件 Schema 32）](<adr/0078-unequal-shell.md>)
- [ADR 0079：唇與溝槽（Phase 6-5，C4.11，零件 Schema 33）](<adr/0079-lip-groove.md>)
- [ADR 0080：螺柱（Phase 6-6，C4.11，零件 Schema 34）](<adr/0080-screw-boss.md>)
- [ADR 0081：卡榫、卡榫的窗、排氣口（Phase 6-7，C4.11，零件 Schema 35）](<adr/0081-snap-hook-catch-vent.md>)
- [ADR 0082：Phase 6 驗收 A 段（6-8，塑膠件）](<adr/0082-acceptance-6.md>)
- [ADR 0083：鈑金的技術驗證（Phase 7-0，C11）](<adr/0083-sheet-metal-validation.md>)
- [ADR 0084：鈑金參數與基材凸緣（Phase 7-1，C11.1，零件 Schema 36）](<adr/0084-base-flange.md>)
- [ADR 0085：邊線凸緣（Phase 7-2，C11.2，零件 Schema 37）](<adr/0085-edge-flange.md>)
- [ADR 0086：摺邊（Phase 7-3，C11.2，零件 Schema 38）](<adr/0086-hem.md>)
- [ADR 0087：凸緣縮短與離隙（Phase 7-4，C11.4，零件 Schema 39）](<adr/0087-insets-reliefs.md>)
- [ADR 0088：平板型式（Phase 7-5，C11.3）](<adr/0088-flat-pattern.md>)
- [ADR 0089：平板型式的 DXF 輸出（Phase 7-6，C11.3、F3.1）](<adr/0089-flat-pattern-dxf.md>)
- [ADR 0090：量規表與可製造性檢查（Phase 7-7，C11.1、C11，零件 Schema 40）](<adr/0090-gauge-checks.md>)
- [ADR 0091：Phase 7 驗收 A 段（7-8，鈑金）](<adr/0091-acceptance-7.md>)
- [ADR 0092：併面時舊面保留原名（鞏固 H-1，持久命名）](<adr/0092-naming-merge.md>)
- [ADR 0093：螺柱孔的拔模、摺邊不算「最小半徑」（鞏固 H-4，零件 Schema 41）](<adr/0093-hole-draft-hem-rule.md>)
- [ADR 0094：隨機產生的零件（鞏固 H-5）](<adr/0094-random-tests.md>)
- [ADR 0095：封閉角落（鞏固 H-6，C11.4，零件 Schema 42）](<adr/0095-closed-corner.md>)
- [ADR 0096：全面盤點與清理（鞏固 H-11）](<adr/0096-inventory-cleanup.md>)
- [ADR 0097：圓角與導角選面的技術驗證（F-0）](<adr/0097-fillet-by-face-validation.md>)
- [ADR 0098：圓角與導角選面、面圓角、完整圓角（零件 Schema 43）](<adr/0098-fillet-by-face.md>)
- [ADR 0099：草圖吸附與推斷（S-1 到 S-4）](<adr/0099-sketch-snapping.md>)
- [ADR 0100：工程圖的角度尺寸（工程圖 Schema 5）與下拉選單](<adr/0100-drawing-angle-dimension.md>)
- [ADR 0101：螺紋孔與錐孔的孔標註（D-1）](<adr/0101-hole-callouts-thread-countersink.md>)
- [ADR 0102：DXF 的 DIMENSION 圖元（D-2）](<adr/0102-dxf-dimension-entities.md>)
- [ADR 0103：爆炸線與爆炸動畫（E-1）](<adr/0103-explode-lines-animation.md>)
- [ADR 0104：多組爆炸（E-2，組合件 Schema 7）](<adr/0104-several-exploded-views.md>)
- [ADR 0105：形成次組合件（E-3，檔案格式不變）](<adr/0105-form-sub-assembly.md>)
- [ADR 0106：工程圖的展平圖（S-1，工程圖 Schema 6）](<adr/0106-flat-pattern-in-drawing.md>)
- [ADR 0107：卡榫的「鉤下面的窗」做成卡榫的選項（零件 Schema 44）](<adr/0107-snap-hook-window.md>)
- [ADR 0108：厚面的「兩側」與「保留曲面」（零件 Schema 45）](<adr/0108-thicken-both-keep.md>)
- [ADR 0109：互相修剪曲面（P-3，零件 Schema 46）](<adr/0109-mutual-trim.md>)
- [ADR 0110：邊線凸緣的斜接（S-2，C11.4，零件 Schema 47）](<adr/0110-miter.md>)
- [ADR 0111：中間折彎（S-3，零件 Schema 48）](<adr/0111-mid-bend.md>)
- [ADR 0112：厚面遇到尖角時拒絕（Schema 不變）](<adr/0112-thicken-sharp-edge.md>)
- [ADR 0113：折彎之後才切的孔進平板型式（Schema 不變）](<adr/0113-cuts-in-flat-pattern.md>)
- [ADR 0114：折過的基材上的凸緣，平板型式（Schema 不變）](<adr/0114-bent-base-flange-flat.md>)
- [ADR 0115：在 3D 視窗顯示展開的狀態（Schema 不變）](<adr/0115-flat-in-3d-view.md>)
- [ADR 0116：草圖圖片（零件 Schema 49）](<adr/0116-sketch-picture.md>)
- [ADR 0117：沒有在編輯時也能選邊線與頂點（Schema 不變）](<adr/0117-select-edges-idle.md>)
- [ADR 0118：開發伺服器隨最後一個分頁關閉而自己結束（Schema 不變）](<adr/0118-dev-auto-close.md>)
- [ADR 0119：號球與表格可以用滑鼠拖（工程圖 Schema 8 → 9）](<adr/0119-movable-balloons-and-tables.md>)
- [ADR 0120：離隙的形狀——長圓與撕裂（零件 Schema 49 → 50）](<adr/0120-relief-shapes.md>)
- [ADR 0121：鈑金斷開角落（C11.4，零件 Schema 50 → 51）](<adr/0121-sheet-break-corner.md>)
- [ADR 0122：以曲面除料的方向向量與保留側（C9.4，零件 Schema 51 → 52）](<adr/0122-surface-cut-vector.md>)
- [ADR 0123：真實螺牙特徵資料結構與再生管道（零件 Schema 52 → 53）](<adr/0123-thread-feature.md>)
- [ADR 0124：壓花特徵（零件 Schema 53 → 54）](<adr/0124-knurl-feature.md>)
- [ADR 0125：工程圖表面粗糙度標註與單向極限公差（工程圖 Schema 9 → 10）](<adr/0125-drawing-surface-finish-and-one-sided-tolerance.md>)
- [ADR 0126：幾何核心的記憶體高水位自動重啟（Worker Heap Recycling）](<adr/0126-worker-heap-recycling.md>)
- [ADR 0127：草圖平面的入口與圖面上的基準幾何（Schema 版本不變）](<adr/0127-sketch-plane-entries.md>)
- [ADR 0128：工程圖語言獨立於介面語言（工程圖 Schema 10 → 11）](<adr/0128-drawing-language.md>)
- [ADR 0129：工程圖交互改進路線（提前 C16 的 P2 項）](<adr/0129-drawing-interaction-roadmap.md>)
- [ADR 0130：工程圖的多重選取與一次修改（D-I1a）](<adr/0130-drawing-multi-selection.md>)
- [ADR 0131：比照 SolidWorks，在圖紙上拖曳與點選產生視圖和剖面（D-V）](<adr/0131-drawing-views-by-pointer.md>)
- [ADR 0132：工程圖的註解、基準、幾何公差與手動中心線（D-I3，工程圖 Schema 11 → 12）](<adr/0132-drawing-annotations-gdt.md>)
- [ADR 0133：工程圖側邊欄比照 SolidWorks 的結構（D-I1b 提前）](<adr/0133-drawing-sidebar-like-solidworks.md>)
- [ADR 0134：新工程圖從空白圖頁開始，先選主視圖，尺寸按需標註（D-V2）](<adr/0134-drawing-main-view-first.md>)
- [ADR 0135：「關閉伺服器」按鈕徹底結束開發中的系統（Schema 不變）](<adr/0135-dev-shutdown-button.md>)
- [ADR 0136：草圖吸附延伸到草圖平面外的模型邊（投影）與貫穿點（Schema 不變）](<adr/0136-sketch-snap-projected-edges.md>)
- [ADR 0137：重建的決定性（B3.1）——求解輸出上網格、每次重建全新求解器、布林結果面命名繼承](<adr/0137-deterministic-rebuilds.md>)
- [ADR 0138：視圖的邊與頂點有名字，尺寸可以標在頂點與邊上，等角視圖也行（D-I2，第一部分）](<adr/0138-drawing-named-view-edges.md>)
- [ADR 0139：座標尺寸、尺寸對正與自動排列（D-I4）](<adr/0139-drawing-ordinate-arrange.md>)
- [ADR 0140：從工程圖的視圖開啟零件，返回後自動更新（D-I7(a)）](<adr/0140-drawing-open-part.md>)
- [ADR 0141：工程圖的 CommandManager 頁籤、右鍵選單與特徵樹（D-I1b）](<adr/0141-drawing-commands-menus-tree.md>)
- [ADR 0142：任意角度的剖面線（D-I5 第一部分）](<adr/0142-drawing-slanted-section.md>)
- [ADR 0143：階梯剖面與對正剖面（D-I5 第一部分之二）](<adr/0143-drawing-stepped-aligned-section.md>)
- [ADR 0144：組合件設計樹展開零件——零件自己的原點、基準面與特徵，拿來做結合](<adr/0144-assembly-component-datums-in-tree.md>)
- [ADR 0145：選擇濾器比照 SolidWorks 工具列（隱藏預設、F5/F6、單選）](<adr/0145-selection-filter-sw-toolbar.md>)
- [ADR 0146：工程圖六項與 SolidWorks 對齊——回到零件、顯示樣式與塗彩、剖面解除對齊、尺寸樣式、斜角等角投影](<adr/0146-drawing-sw-parity-six.md>)
- [ADR 0147：新工程圖的「最適比例」與存檔——存檔等它、它併入放視圖那一步](<adr/0147-drawing-fit-before-save.md>)
- [ADR 0148：組合件的「正視於」與選擇濾器——兩者原本只限零件](<adr/0148-assembly-view-normal-and-filter.md>)
- [ADR 0149：「正視於」沒有可看的平面時轉到最近的標準視角、視角方塊加翻面鈕](<adr/0149-view-normal-nearest-and-cube-flip.md>)
- [ADR 0150：標題欄的文字樣式——欄位名稱、數值與標題的字高，以及超出儲存格時自動縮小](<adr/0150-drawing-title-block-text-style.md>)
- [ADR 0151：斷裂視圖（D-I6 第一部分）](<adr/0151-drawing-break-view.md>)
- [ADR 0152：裁剪視圖（D-I6 第二部分）](<adr/0152-drawing-crop-view.md>)
- [ADR 0153：輔助視圖（D-I6 第三部分）](<adr/0153-drawing-auxiliary-view.md>)
- [ADR 0154：工程圖多圖頁——資料模型與遷移（B2.8 第一部分）](<adr/0154-drawing-pages.md>)
- [ADR 0155：零件／組合件側邊欄的兩分頁與「切換只隱藏」契約（E1-P2）](<adr/0155-sidebar-tabs-hidden-contract.md>)
- [ADR 0156：裝飾螺紋線特徵與全鏈路渲染出圖（零件 Schema 56 → 57）](<adr/0156-cosmetic-threads.md>)
- [ADR 0157: 草圖橢圓圖元與長出實體全鏈路架構 (Sketch Ellipse Feature)](<adr/0157-sketch-ellipse.md>)
- [ADR 0158: 實體分割特徵 (Split Body Feature, C7.4)](<adr/0158-split-body.md>)
- [ADR 0159：鈑金凸折特徵（Sheet Metal Jog Feature，零件 Schema 60）](<adr/0159-sheet-metal-jog.md>)
- [ADR 0160: 草圖樣條曲線圖元與造型實體全鏈路架構 (Sketch Spline Feature)](<adr/0160-sketch-spline.md>)
- [ADR 0161: 鈑金斷開角落與角落修剪全鏈路架構 (Sheet Metal Break Corner Feature)](<adr/0161-sheet-metal-break-corner.md>)
- [ADR 0162: 草圖參考圖元與相交曲線全鏈路實作 (Sketch Convert Entities & Intersection Curves)](<adr/0162-convert-entities.md>)
- [ADR 0163: 草圖文字特徵與 3D 刻印/雕刻管線 (Sketch Text Feature & 3D Engraving/Embossing)](<adr/0163-sketch-text.md>)
- [ADR 0164: 實體移動與複製本體特徵 (Move/Copy Body Feature, C7.3)](<adr/0164-move-copy-body.md>)
- [ADR 0165: 實體刪除與保留本體特徵 (Delete / Keep Body Feature, C7.3)](<adr/0165-delete-keep-body.md>)
- [ADR 0166: 沿曲線/邊線複製排列特徵 (Curve-driven Pattern Feature, C6.4)](<adr/0166-curve-driven-pattern.md>)
- [ADR 0167: 變化半徑圓角 (Variable Radius Fillet, C5.2)](<adr/0167-variable-radius-fillet.md>)
- [ADR 0168: 螺旋曲線與渦捲線特徵 (Helix / Spiral Curve Feature, C8.3)](<adr/0168-helix-spiral-curve.md>)
- [ADR 0169：沿螺旋曲線掃出（彈簧）](<adr/0169-sweep-along-helix.md>)
- [ADR 0170：草圖內建水平軸與垂直軸（G1）](<adr/0170-sketch-origin-axes.md>)
- [ADR 0171：模型頂點投影成草圖點（G2）](<adr/0171-sketch-vertex-points.md>)
- [ADR 0172：基準軸、基準點、基準面進草圖（G3）；草圖參照補入 DAG](<adr/0172-sketch-datum-references.md>)
- [ADR 0173：任意曲線的貫穿點（G4）](<adr/0173-pierce-any-curve.md>)
- [ADR 0174：參考平面「垂直於曲線」（G5）](<adr/0174-plane-normal-to-curve.md>)
- [ADR 0175：草圖參照較前面的草圖（G6）](<adr/0175-sketch-references-to-sketches.md>)
- [ADR 0176：零件、草圖、組合件畫面的右鍵選單](<adr/0176-graphics-area-context-menus.md>)
- [ADR 0177：工程圖尺寸類型與右鍵選單](<adr/0177-drawing-dimension-kinds-and-context-menu.md>)
- [ADR 0178：草圖的移動／複製／旋轉／縮放圖元與線性、環狀草圖陣列](<adr/0178-sketch-move-copy-rotate-scale-and-patterns.md>)
- [ADR 0179：組合件「以座標軸移動」（Move with Triad）](<adr/0179-assembly-move-with-triad.md>)
- [ADR 0180：看得見的干涉檢查（縮放到干涉、淡化其他零組件、紅圈、位置、忽略）](<adr/0180-interference-made-visible.md>)
- [ADR 0181：草圖附著，原點與 X 方向取自模型（G7）](<adr/0181-sketch-attachment.md>)
- [ADR 0182：固定整個圖元（Block，G8a）](<adr/0182-sketch-block.md>)
- [ADR 0183：圓弧條件，最近與最遠距離（G8b）](<adr/0183-distance-arc-condition.md>)
- [0184：孔／裝飾螺紋標註的顯示樣式](<adr/0184-drawing-thread-callout-style.md>)
- [0185：圖紙標註預設、側視螺紋引線與公差等級](<adr/0185-drawing-thread-leaders-defaults-tolerances.md>)
- [ADR 0186：3D 框選、SmartMates 與 Instant3D](<adr/0186-selection-smartmates-instant3d.md>)
- [ADR 0187：投影曲線 C8.2](<adr/0187-projected-curves.md>)
- [ADR 0188：操作改善 E6](<adr/0188-productivity-controls.md>)
- [ADR 0189：D3 草圖關係與側影](<adr/0189-sketch-curvature-point-symmetry-silhouette.md>)
- [ADR 0190：D5 曲面工具](<adr/0190-ruled-radiated-replace-face.md>)
- [ADR 0191：E2+ 延展與連動草圖陣列](<adr/0191-stretch-linked-sketch-patterns.md>)
- [ADR 0192：尺寸文字與標註線連動拖曳](<adr/0192-dimension-line-drag.md>)
- [ADR 0193：參數式直齒外齒輪與齒條](<adr/0193-gear-and-rack-builders.md>)
- [ADR 0194：共用草圖端點的接續延伸](<adr/0194-extend-shared-sketch-endpoints.md>)
- [ADR 0195：草圖拘束六項擴充](<adr/0195-sketch-constraint-expansion.md>)
- [ADR 0197：模型透明塗彩](<adr/0197-transparent-shaded-view.md>)
- [ADR 0198：剖面線區域與紙面樣式](<adr/0198-section-hatch-regions-and-style.md>)
- [ADR 0199：鈑金連續折彎、展開加工／摺回與加工圖](<adr/0199-sheet-manufacturing-workflow.md>)
- [ADR 0200：部分展開、跨彎曲帶加工與角落映射](<adr/0200-sheet-partial-unfold-curved-machining.md>)
- [ADR 0201：SolidCraft工具圖示與選單重新規劃](<adr/0201-solidcraft-icons-and-menu-design.md>)
- [ADR 0202：視窗預設網格與隱藏恢復入口](<adr/0202-viewport-grid-and-hidden-recovery.md>)
- [ADR 0203：浮動參數窗、組合件來源編輯與動態拉伸](<adr/0203-floating-editor-assembly-source-and-live-extrusion.md>)
- [ADR0204：可重算盤點、文件責任與無功能變更清理](<adr/0204-repository-maintenance-and-document-ownership.md>)
- [ADR 0205：由孔口選取建立加工入口錐面的通用工具](<adr/0205-thread-entrance-tool.md>)
- [ADR 0206：工程圖尺寸選點、顯示與位置互動](<adr/0206-drawing-dimension-interaction.md>)
- [ADR 0207：分零件剖面線與可編輯視圖標籤](<adr/0207-component-hatches-and-view-captions.md>)
- [ADR 0208：工程圖持久磁吸點與組合件解析參照](<adr/0208-drawing-reference-points.md>)
- [ADR 0209：錐面側視輪廓的連動導角尺寸](<adr/0209-conical-chamfer-dimensions.md>)
- [ADR 0210：投影輪廓參照與非對稱公差](<adr/0210-projected-references-and-asymmetric-tolerances.md>)
- [ADR 0211：關係不能靠把直線壓成一個點來滿足](<adr/0211-relations-do-not-shrink-lines.md>)
- [ADR 0212：兩條線的交點可作為智慧型尺寸的參考點](<adr/0212-line-crossing-as-dimension-reference.md>)
- [ADR 0213：已經成立的關係不再被要求一次；被拒絕時說清楚為什麼](<adr/0213-relations-that-already-hold.md>)
- [ADR 0214：圓角結果的容差閘門](<adr/0214-fillet-tolerance-gate.md>)
- [ADR 0215：草圖選取候選與取消預覽](<adr/0215-sketch-selection-candidates.md>)
- [ADR 0216：不會被接受的限制條件按鈕不顯示（試算後過濾）](<adr/0216-trial-filtered-relation-buttons.md>)
- [ADR 0217：草圖線與曲面輪廓的限制條件](<adr/0217-sketch-relations-to-face-outlines.md>)
- [ADR 0218：移動面至目標平面](<adr/0218-move-face-target-plane.md>)
- [ADR 0219：匯入 DXF 到草圖（F2.6）](<adr/0219-dxf-import-into-sketch.md>)
- [ADR 0220：IGES 輸出與輸入（F1.4、F2.2）](<adr/0220-iges-exchange.md>)

### 歷史驗證

- [Phase 0 驗收紀錄](<phase0-verification.md>)
- [Phase 1 驗收紀錄](<phase1-verification.md>)
- [人工驗證清單的自動化覆蓋（更新至 2026-10-30）](<verification-coverage.md>)

### 清理紀錄

- [清理盤點與保留政策](<cleanup-candidates.md>)

### 測試資料說明

- [舊版文件樣本](<../tests/fixtures/old-versions/README.md>)
- [OSF sheet-press STEP samples](<../tests/fixtures/public-cad/osf-sheet-press/README.md>)
- [External DXF samples (bjnortier/dxf)](<../tests/fixtures/public-dxf/bjnortier-dxf/README.md>)
- [STEP 樣本](<../tests/fixtures/step/README.md>)
- [金樣零件（Phase 1 驗收 ①②）](<../tests/golden/README.md>)

### 產品現況

- [產品現況與能力邊界](<project-state.md>)

### 研究證據

- [OCCT 綁定缺口技術驗證](<../spikes/occt-gaps/README.md>)
- [OCCT 綁定盤點](<../spikes/occt-gaps/inventory.md>)

### 範圍規格

- [3D-Builder 開發藍圖 — 類 SolidWorks 參數式 CAD（Web 先行、一人 + AI）](<blueprint.md>)

### 能力規格

- [草圖拘束六項擴充](<sketch-constraint-expansion.md>)

### 衍生盤點

- [儲存庫盤點（自動產生）](<repository-inventory.md>)

### 設計提案

- [3D-Builder 選單與工具圖示重新規劃](<design/menu-redesign/plan.md>)
- [草圖互動方案：執行驗收表](<design/sketch-interaction/acceptance.md>)
- [草圖建構互動比較與改進計畫](<design/sketch-interaction/plan.md>)

### 設計歷史

- [圓角在工程圖上可點選的影響面盤點（E1a）](<fillet-picking-impact.md>)
- [介面交互審查：對照 SolidWorks 與 FreeCAD（2026-10-20）](<ui-interaction-audit.md>)

### 開發操作

- [開發、驗證與跨平台操作](<development.md>)

### 階段計畫快照

- [組合件：爆炸線與動畫、多組爆炸、形成新次組合件（計畫）](<assembly-explode-plan.md>)
- [工程圖：螺紋孔與錐形沉孔的標註、DXF 的 DIMENSION 圖元（計畫）](<drawing-callouts-plan.md>)
- [工程圖交互邏輯：與 SolidWorks / FreeCAD TechDraw 的差距分析與改進規劃（草案）](<drawing-interaction-gap-plan.md>)
- [圓角與導角可選面的計畫（含面圓角、完整圓角）](<fillet-by-face-plan.md>)
- [鞏固計畫（Phase 3a–7 之後）](<hardening-plan.md>)
- [說明系統計畫（比照 SolidWorks 的「說明」；單一來源 SSOT）](<help-plan.md>)
- [Phase 3 計畫（草案）](<phase3-plan.md>)
- [Phase 4a 計畫：加工／組裝夾具](<phase4a-plan.md>)
- [Phase 4b 計畫：檢具](<phase4b-plan.md>)
- [Phase 5 計畫：工程圖](<phase5-plan.md>)
- [Phase 6 計畫：塑膠件](<phase6-plan.md>)
- [Phase 7 計畫：鈑金](<phase7-plan.md>)
- [鈑金：平板型式進工程圖、斜接、凸折（計畫）](<sheet-metal-drawing-plan.md>)
- [零件 / 組合件側邊欄比照工程圖(ADR 0133)重做 — 範圍與方案](<sidebar-parity-plan.md>)
- [草圖吸附與推斷計畫（參照 SolidWorks；已實作並提交）](<sketch-snapping-plan.md>)
- [曲面互相修剪（P-3）：小驗證與計畫](<surface-trim-plan.md>)
- [螺牙（真實螺紋實體）：計畫與驗證方案](<thread-plan.md>)

### 驗證操作

- [Automated acceptance evidence](<automated-acceptance.md>)

## 資源盤點

逐位元相同的檔案群組：0。相同內容只是候選，不能據此刪除不同平台圖示、測試探針或授權原稿。
