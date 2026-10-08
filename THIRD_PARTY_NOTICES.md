# 第三方授權清單（THIRD_PARTY_NOTICES）

- 產生日期：2026-10-08（由 `npm ls --all --json`、各套件自己的 `package.json` 與 `cargo metadata` 彙整；版本以 `package-lock.json` 與 `apps/desktop/src-tauri/Cargo.lock` 為準）。
- 用途：記錄本專案用到哪些第三方元件、各是什麼授權、散佈時要做什麼。**這份清單是技術盤點，不是法律意見**；對外散佈或商品化前請讓律師看過。
- 本專案自己的程式碼：**目前沒有 `LICENSE` 檔**（保留所有權利）；定位是個人或公司內部使用（[README](README.md) 的「授權說明」）。要對外散佈，先決定本專案自己的授權。
- 更新方式：新增或升級依賴後重新掃描，並更新本文件。掃描的做法是對每個套件讀 `node_modules/<名稱>/package.json` 的 `license` 欄位；欄位沒寫的標「?」，要人工看授權檔。

## 1. 摘要

| 範圍 | 數量 | 授權種類 | 要特別處理的 |
|---|---|---|---|
| **隨網頁版一起散佈的 npm 套件**（第 2 節） | 9 | MIT ×6、LGPL-2.0-or-later ×1、Apache-2.0 ×1、LGPL-2.1-only WITH Open-CASCADE-Exception-1.0 ×1 | libcascade 與 planegcs（LGPL） |
| 只在開發與建置時用、不隨成品散佈的 npm 套件（第 3 節） | 53 | MIT ×41、Apache-2.0 ×5、Apache-2.0 OR MIT ×2、MPL-2.0 ×2、ISC ×1、LGPL-2.1-only ×1、BSD-3-Clause ×1 | replicad-opencascadejs（LGPL，只有 `spikes/` 用到）；lightningcss（MPL-2.0，建置工具） |
| **桌面版（Tauri）的 Rust 套件**（第 4 節） | 246 | MIT 或 Apache-2.0 為主 | 5 個 MPL-2.0 的 crate |
| 沒有 GPL、AGPL 或「禁止商用」類的授權 | | | 以上三個範圍都沒有發現（LGPL 是較寬鬆的另一種，見第 2 節） |

## 2. 隨網頁版散佈的 npm 套件（runtime）

| 套件 | 版本 | 授權 | 備註 |
|---|---|---|---|
| [@salusoft89/planegcs](https://github.com/Salusoft89/planegcs) | 1.2.0 | LGPL-2.0-or-later | **LGPL。** FreeCAD PlaneGCS 的 WebAssembly 版（草圖求解）；見第 2 節。 |
| [comlink](https://github.com/GoogleChromeLabs/comlink) | 4.4.2 | Apache-2.0 |  |
| [immer](https://github.com/immerjs/immer#readme) | 11.1.18 | MIT |  |
| [libcascade](https://github.com/taucad/opencascade.js#readme) | 3.0.2 | LGPL-2.1-only WITH Open-CASCADE-Exception-1.0 | **LGPL。** Open CASCADE（B-Rep 核心）的 WebAssembly 版；見第 2 節。 |
| [react](https://react.dev/) | 19.3.0 | MIT |  |
| [react-dom](https://react.dev/) | 19.3.0 | MIT |  |
| [scheduler](https://react.dev/) | 0.28.0 | MIT |  |
| [three](https://threejs.org/) | 0.186.1 | MIT |  |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh#readme) | 0.9.15 | MIT |  |

### LGPL 元件的義務（libcascade、planegcs）

- **libcascade**（授權：LGPL-2.1-only 加 Open CASCADE 例外條款，全文在 `node_modules/libcascade/LICENSE` 與 `LICENSE.OCCT-Exception`）與 **@salusoft89/planegcs**（LGPL-2.0-or-later）是以 WebAssembly 檔案的形式載入，本專案的程式碼只透過它們的公開介面呼叫，沒有修改它們的原始碼。
- 內部使用（不對外散佈）：LGPL 對這種使用沒有額外要求。
- **對外散佈時要做的事（尚未做）：**
  1. 在成品裡附上這些元件的授權全文與著作權聲明（可以用本檔加各套件的 LICENSE）。
  2. 讓使用者能換成自己修改過的版本（LGPL 的「可替換」要求）。libcascade 在套件裡的 WASM 是獨立檔案（`dist` 下的 `opencascade_single.wasm` 與 `opencascade_multi.wasm`，各約 42 MB），這對可替換有利；但**打包（Vite）後的實際輸出我還沒檢查**，要確認 WASM 與 planegcs 仍是可替換的獨立檔案，以及要不要提供重新連結的做法。
  3. 提供這些元件的原始碼取得方式（指向它們的公開儲存庫或套件，並註明版本）。
  4. 若日後修改這些元件本身，修改後的原始碼要公開。
- libcascade 預先編好的二進位內含 OCCT 與可能的其他 C++ 函式庫；**它是否還附帶其他授權的程式碼，我沒有逐一確認**，散佈前請對照它的發行說明。

## 3. 開發與建置用的 npm 套件（不隨成品散佈）

這些在建置或測試時使用，不會被打包進成品。仍列出，以便稽核。

- **replicad-opencascadejs 1.1.0**（LGPL-2.1-only）：根目錄 `package.json` 的 devDependency，只有 `spikes/occt-gaps/` 的試驗與 ADR 0002、0003 提到，產品程式沒有引用。
- **lightningcss**（MPL-2.0，含它的 Windows 二進位套件）：Vite 用來處理 CSS 的建置工具，輸出的 CSS 不含它的程式碼。
- `@dimforge/rapier3d-compat`、`@tweenjs/tween.js`、`fflate`、`meshoptimizer`、`@types/stats.js`、`@types/webxr`：都是 `@types/three`（three.js 的型別宣告）帶進來的依賴，只在型別檢查時存在；本專案沒有引用它們，也不在成品裡。

<details><summary>完整清單（53 個）</summary>

| 套件 | 版本 | 授權 |
|---|---|---|
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0 |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @oxc-project/types | 0.151.0 | MIT |
| @rolldown/binding-win32-x64-msvc | 1.2.11 | MIT |
| @rolldown/pluginutils | 1.0.1 | MIT |
| @tauri-apps/cli | 2.12.1 | Apache-2.0 OR MIT |
| @tauri-apps/cli-win32-x64-msvc | 2.12.1 | Apache-2.0 OR MIT |
| @tweenjs/tween.js | 23.1.3 | MIT |
| @types/chai | 5.2.3 | MIT |
| @types/deep-eql | 4.0.2 | MIT |
| @types/estree | 1.0.9 | MIT |
| @types/node | 26.6.3 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @types/stats.js | 0.17.4 | MIT |
| @types/three | 0.186.0 | MIT |
| @types/webxr | 0.5.24 | MIT |
| @typescript/typescript-win32-x64 | 7.0.2 | Apache-2.0 |
| @vitejs/plugin-react | 6.1.1 | MIT |
| @vitest/mocker | 5.0.2 | MIT |
| @vitest/spy | 5.0.2 | MIT |
| assertion-error | 2.0.1 | MIT |
| chai | 6.2.2 | MIT |
| csstype | 3.2.3 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| es-module-lexer | 2.3.2 | MIT |
| estree-walker | 3.0.3 | MIT |
| expect-type | 1.4.0 | Apache-2.0 |
| fdir | 6.5.0 | MIT |
| fflate | 0.8.3 | MIT |
| lightningcss | 1.33.0 | MPL-2.0 |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 |
| magic-string | 1.4.2 | MIT |
| meshoptimizer | 1.1.1 | MIT |
| nanoid | 3.3.19 | MIT |
| obug | 2.2.1 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 4.0.7 | MIT |
| postcss | 8.5.28 | MIT |
| replicad-opencascadejs | 1.1.0 | LGPL-2.1-only |
| rolldown | 1.2.11 | MIT |
| source-map-js | 1.2.1 | BSD-3-Clause |
| std-env | 4.2.0 | MIT |
| tinybench | 6.2.0 | MIT |
| tinyexec | 1.3.1 | MIT |
| tinyglobby | 0.2.17 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| undici-types | 8.9.0 | MIT |
| vite | 8.3.1 | MIT |
| vitest | 5.0.2 | MIT |
| why-is-node-running | 3.2.2 | MIT |

</details>

## 4. 桌面版（Tauri）的 Rust 套件

桌面版（`apps/desktop`）依 `Cargo.lock` 目前有 246 個第三方 crate（以 Windows x64 為目標，含建置期依賴）。

| 授權 | 數量 |
|---|---|
| MIT OR Apache-2.0 | 125 |
| MIT | 43 |
| Apache-2.0 OR MIT | 24 |
| Unicode-3.0 | 18 |
| Unlicense OR MIT | 8 |
| MIT/Apache-2.0 | 5 |
| MPL-2.0 | 5 |
| BSD-3-Clause | 2 |
| Zlib | 2 |
| MIT OR Zlib OR Apache-2.0 | 2 |
| Unlicense/MIT | 2 |
| 0BSD OR MIT OR Apache-2.0 | 1 |
| BSD-3-Clause AND MIT | 1 |
| BSD-3-Clause/MIT | 1 |
| Apache-2.0 AND MIT | 1 |
| CC0-1.0 OR MIT-0 OR Apache-2.0 | 1 |
| Apache-2.0 / MIT | 1 |
| MIT OR Apache-2.0 OR Zlib | 1 |
| Apache-2.0 | 1 |
| Zlib OR Apache-2.0 OR MIT | 1 |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 1 |

- **MPL-2.0 的 crate**：cssparser 0.37.0、cssparser-macros 0.7.1、dtoa-short 0.3.5、option-ext 0.2.0、selectors 0.38.0。MPL-2.0 是檔案層級的 copyleft：沒有修改它們時，散佈二進位檔要附授權聲明並說明原始碼在哪裡取得（crates.io 上的原始版本）。
- 桌面版的畫面就是網頁版，所以第 2 節的 npm 套件與 LGPL 義務同樣適用於桌面版安裝檔。
- Tauri 本身是 MIT 或 Apache-2.0；桌面版使用 Windows 的 WebView2（微軟的元件，不隨本專案散佈，由使用者的系統提供）。
- 對外散佈桌面版安裝檔時，要附上這些 crate 的授權聲明；建議用 `cargo about` 或 `cargo-license` 產生完整文字（本檔只記到授權名稱與數量）。

<details><summary>完整清單（246 個）</summary>

| crate | 版本 | 授權 |
|---|---|---|
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| aho-corasick | 1.1.5 | Unlicense OR MIT |
| alloc-no-stdlib | 3.0.0 | BSD-3-Clause |
| alloc-stdlib | 0.3.0 | BSD-3-Clause |
| anyhow | 1.0.104 | MIT OR Apache-2.0 |
| autocfg | 1.5.1 | Apache-2.0 OR MIT |
| base64 | 0.22.1 | MIT OR Apache-2.0 |
| base64 | 0.23.1 | MIT OR Apache-2.0 |
| bit-set | 0.8.0 | Apache-2.0 OR MIT |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT |
| bitflags | 1.3.2 | MIT/Apache-2.0 |
| bitflags | 2.13.2 | MIT OR Apache-2.0 |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 |
| brotli | 9.0.0 | BSD-3-Clause AND MIT |
| brotli-decompressor | 6.0.1 | BSD-3-Clause/MIT |
| bs58 | 0.5.1 | MIT/Apache-2.0 |
| byteorder | 1.5.0 | Unlicense OR MIT |
| bytes | 1.12.1 | MIT |
| camino | 1.2.6 | MIT OR Apache-2.0 |
| cargo_metadata | 0.19.2 | MIT |
| cargo_toml | 1.0.1 | Apache-2.0 OR MIT |
| cargo-platform | 0.1.9 | MIT OR Apache-2.0 |
| cc | 1.5.1 | MIT OR Apache-2.0 |
| cfb | 0.14.0 | MIT |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 |
| chrono | 0.4.45 | MIT OR Apache-2.0 |
| cookie | 0.18.2 | MIT OR Apache-2.0 |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 |
| crc32fast | 1.5.2 | MIT OR Apache-2.0 |
| crossbeam-channel | 0.5.17 | MIT OR Apache-2.0 |
| crossbeam-utils | 0.8.23 | MIT OR Apache-2.0 |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 |
| cssparser | 0.37.0 | MPL-2.0 |
| cssparser-macros | 0.7.1 | MPL-2.0 |
| ctor | 1.0.13 | Apache-2.0 OR MIT |
| darling | 0.24.1 | MIT |
| darling_core | 0.24.1 | MIT |
| darling_macro | 0.24.1 | MIT |
| defmt | 1.1.1 | MIT OR Apache-2.0 |
| defmt-macros | 1.1.1 | MIT OR Apache-2.0 |
| defmt-parser | 1.0.0 | MIT OR Apache-2.0 |
| deranged | 0.5.8 | MIT OR Apache-2.0 |
| derive_more | 2.1.1 | MIT |
| derive_more-impl | 2.1.1 | MIT |
| digest | 0.10.7 | MIT OR Apache-2.0 |
| dirs | 7.0.0 | MIT OR Apache-2.0 |
| dirs-sys | 0.5.0 | MIT OR Apache-2.0 |
| displaydoc | 0.2.7 | MIT OR Apache-2.0 |
| dom_query | 0.28.0 | MIT |
| dpi | 0.1.2 | Apache-2.0 AND MIT |
| dtoa | 1.0.11 | MIT OR Apache-2.0 |
| dtoa-short | 0.3.5 | MPL-2.0 |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| dyn-clone | 1.0.20 | MIT OR Apache-2.0 |
| embed-resource | 3.0.11 | MIT |
| equivalent | 1.0.2 | Apache-2.0 OR MIT |
| erased-serde | 0.4.10 | MIT OR Apache-2.0 |
| fastrand | 2.5.0 | Apache-2.0 OR MIT |
| fdeflate | 0.3.7 | MIT OR Apache-2.0 |
| find-msvc-tools | 0.1.14 | MIT OR Apache-2.0 |
| flate2 | 1.1.10 | MIT OR Apache-2.0 |
| fnv | 1.0.7 | Apache-2.0 / MIT |
| foldhash | 0.2.0 | Zlib |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 |
| generic-array | 0.14.7 | MIT |
| getrandom | 0.3.4 | MIT OR Apache-2.0 |
| getrandom | 0.4.3 | MIT OR Apache-2.0 |
| glob | 0.3.4 | MIT OR Apache-2.0 |
| hashbrown | 0.12.3 | MIT OR Apache-2.0 |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 |
| heck | 0.5.0 | MIT OR Apache-2.0 |
| hex | 0.4.3 | MIT OR Apache-2.0 |
| html5ever | 0.39.0 | MIT OR Apache-2.0 |
| http | 1.5.0 | MIT OR Apache-2.0 |
| ico | 0.5.0 | MIT |
| icu_collections | 2.3.0 | Unicode-3.0 |
| icu_locale_core | 2.3.0 | Unicode-3.0 |
| icu_normalizer | 2.3.0 | Unicode-3.0 |
| icu_normalizer_data | 2.3.0 | Unicode-3.0 |
| icu_properties | 2.3.0 | Unicode-3.0 |
| icu_properties_data | 2.3.0 | Unicode-3.0 |
| icu_provider | 2.3.1 | Unicode-3.0 |
| ident_case | 1.0.1 | MIT/Apache-2.0 |
| idna | 1.1.0 | MIT OR Apache-2.0 |
| idna_adapter | 1.2.2 | Apache-2.0 OR MIT |
| indexmap | 1.9.3 | Apache-2.0 OR MIT |
| indexmap | 2.14.2 | Apache-2.0 OR MIT |
| infer | 0.22.0 | MIT |
| itoa | 1.0.18 | MIT OR Apache-2.0 |
| jiff | 0.2.37 | Unlicense OR MIT |
| jiff-core | 0.1.1 | Unlicense OR MIT |
| jiff-tzdb | 0.1.8 | Unlicense OR MIT |
| jiff-tzdb-platform | 0.1.3 | Unlicense OR MIT |
| json-patch | 4.2.0 | MIT/Apache-2.0 |
| jsonptr | 0.7.1 | MIT OR Apache-2.0 |
| keyboard-types | 0.8.3 | MIT OR Apache-2.0 |
| libc | 0.2.190 | MIT OR Apache-2.0 |
| litemap | 0.8.3 | Unicode-3.0 |
| lock_api | 0.4.14 | MIT OR Apache-2.0 |
| log | 0.4.34 | MIT OR Apache-2.0 |
| markup5ever | 0.39.0 | MIT OR Apache-2.0 |
| memchr | 2.8.3 | Unlicense OR MIT |
| mime | 0.3.17 | MIT OR Apache-2.0 |
| miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 |
| miniz_oxide | 0.9.1 | MIT OR Zlib OR Apache-2.0 |
| mio | 1.2.3 | MIT |
| muda | 0.20.0 | Apache-2.0 OR MIT |
| new_debug_unreachable | 1.0.6 | MIT |
| num-conv | 0.2.2 | MIT OR Apache-2.0 |
| num-traits | 0.2.19 | MIT OR Apache-2.0 |
| once_cell | 1.21.4 | MIT OR Apache-2.0 |
| option-ext | 0.2.0 | MPL-2.0 |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 |
| phf | 0.13.1 | MIT |
| phf_codegen | 0.13.1 | MIT |
| phf_generator | 0.13.1 | MIT |
| phf_macros | 0.13.1 | MIT |
| phf_shared | 0.13.1 | MIT |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT |
| plist | 1.10.1 | MIT |
| png | 0.17.16 | MIT OR Apache-2.0 |
| png | 0.18.1 | MIT OR Apache-2.0 |
| potential_utf | 0.1.6 | Unicode-3.0 |
| powerfmt | 0.2.0 | MIT OR Apache-2.0 |
| precomputed-hash | 0.1.1 | MIT |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 |
| quick-xml | 0.42.0 | MIT |
| quote | 1.0.47 | MIT OR Apache-2.0 |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib |
| ref-cast | 1.0.27 | MIT OR Apache-2.0 |
| ref-cast-impl | 1.0.27 | MIT OR Apache-2.0 |
| regex | 1.13.1 | MIT OR Apache-2.0 |
| regex-automata | 0.4.18 | MIT OR Apache-2.0 |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 |
| rustc_version | 0.4.1 | MIT OR Apache-2.0 |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT |
| same-file | 1.0.6 | Unlicense/MIT |
| schemars | 0.8.22 | MIT |
| schemars | 0.9.0 | MIT |
| schemars | 1.2.2 | MIT |
| schemars_derive | 0.8.22 | MIT |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 |
| selectors | 0.38.0 | MPL-2.0 |
| semver | 1.0.28 | MIT OR Apache-2.0 |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_core | 1.0.229 | MIT OR Apache-2.0 |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 |
| serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 |
| serde_json | 1.0.151 | MIT OR Apache-2.0 |
| serde_repr | 0.1.21 | MIT OR Apache-2.0 |
| serde_spanned | 1.1.1 | MIT OR Apache-2.0 |
| serde_with | 3.24.0 | MIT OR Apache-2.0 |
| serde_with_macros | 3.24.0 | MIT OR Apache-2.0 |
| serde-untagged | 0.1.9 | MIT OR Apache-2.0 |
| serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 |
| serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 |
| servo_arc | 0.4.3 | MIT OR Apache-2.0 |
| sha2 | 0.10.9 | MIT OR Apache-2.0 |
| shlex | 2.0.1 | MIT OR Apache-2.0 |
| simd-adler32 | 0.3.10 | MIT |
| siphasher | 1.0.4 | MIT OR Apache-2.0 |
| smallvec | 1.16.2 | MIT OR Apache-2.0 |
| socket2 | 0.6.5 | MIT OR Apache-2.0 |
| softbuffer | 0.4.8 | MIT OR Apache-2.0 |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 |
| string_cache | 0.9.0 | MIT OR Apache-2.0 |
| string_cache_codegen | 0.6.1 | MIT OR Apache-2.0 |
| strsim | 0.11.1 | MIT |
| syn | 2.0.119 | MIT OR Apache-2.0 |
| syn | 3.0.6 | MIT OR Apache-2.0 |
| synstructure | 0.14.0 | MIT |
| tao | 0.37.1 | Apache-2.0 |
| tauri | 2.12.1 | Apache-2.0 OR MIT |
| tauri-build | 2.7.1 | Apache-2.0 OR MIT |
| tauri-codegen | 2.7.1 | Apache-2.0 OR MIT |
| tauri-macros | 2.7.1 | Apache-2.0 OR MIT |
| tauri-runtime | 2.12.1 | Apache-2.0 OR MIT |
| tauri-runtime-wry | 2.12.1 | Apache-2.0 OR MIT |
| tauri-utils | 2.10.1 | Apache-2.0 OR MIT |
| tauri-winres | 0.3.6 | MIT |
| tendril | 0.5.1 | MIT OR Apache-2.0 |
| thiserror | 2.0.21 | MIT OR Apache-2.0 |
| thiserror-impl | 2.0.21 | MIT OR Apache-2.0 |
| time | 0.3.55 | MIT OR Apache-2.0 |
| time-core | 0.1.9 | MIT OR Apache-2.0 |
| time-macros | 0.2.32 | MIT OR Apache-2.0 |
| tinystr | 0.8.4 | Unicode-3.0 |
| tinyvec | 1.13.3 | Zlib OR Apache-2.0 OR MIT |
| tokio | 1.53.1 | MIT |
| toml | 1.1.6+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_datetime | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_parser | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_writer | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| tracing | 0.1.44 | MIT |
| tracing-core | 0.1.36 | MIT |
| tray-icon | 0.25.1 | MIT OR Apache-2.0 |
| typeid | 1.0.3 | MIT OR Apache-2.0 |
| typenum | 1.20.1 | MIT OR Apache-2.0 |
| unicode-ident | 1.0.26 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 |
| url | 2.5.8 | MIT OR Apache-2.0 |
| urlpattern | 0.6.0 | MIT |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT |
| uuid | 1.27.0 | Apache-2.0 OR MIT |
| version_check | 0.9.5 | MIT/Apache-2.0 |
| vswhom | 0.1.0 | MIT |
| vswhom-sys | 0.1.3 | MIT |
| walkdir | 2.5.0 | Unlicense/MIT |
| web_atoms | 0.2.6 | MIT OR Apache-2.0 |
| web-time | 1.1.0 | MIT OR Apache-2.0 |
| webview2-com | 0.39.1 | MIT |
| webview2-com-macros | 0.8.1 | MIT |
| webview2-com-sys | 0.39.1 | MIT |
| winapi-util | 0.1.11 | Unlicense OR MIT |
| window-vibrancy | 0.8.1 | Apache-2.0 OR MIT |
| windows | 0.62.2 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.52.6 | MIT OR Apache-2.0 |
| windows-collections | 0.3.2 | MIT OR Apache-2.0 |
| windows-core | 0.62.2 | MIT OR Apache-2.0 |
| windows-future | 0.3.2 | MIT OR Apache-2.0 |
| windows-implement | 0.60.2 | MIT OR Apache-2.0 |
| windows-interface | 0.59.3 | MIT OR Apache-2.0 |
| windows-link | 0.2.1 | MIT OR Apache-2.0 |
| windows-numerics | 0.3.1 | MIT OR Apache-2.0 |
| windows-result | 0.4.1 | MIT OR Apache-2.0 |
| windows-strings | 0.5.1 | MIT OR Apache-2.0 |
| windows-sys | 0.59.0 | MIT OR Apache-2.0 |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 |
| windows-targets | 0.52.6 | MIT OR Apache-2.0 |
| windows-threading | 0.2.1 | MIT OR Apache-2.0 |
| windows-version | 0.1.7 | MIT OR Apache-2.0 |
| winnow | 1.0.4 | MIT |
| winreg | 0.55.0 | MIT |
| writeable | 0.6.4 | Unicode-3.0 |
| wry | 0.57.0 | Apache-2.0 OR MIT |
| yoke | 0.8.3 | Unicode-3.0 |
| yoke-derive | 0.8.4 | Unicode-3.0 |
| zerofrom | 0.1.8 | Unicode-3.0 |
| zerofrom-derive | 0.1.8 | Unicode-3.0 |
| zerotrie | 0.2.5 | Unicode-3.0 |
| zerovec | 0.11.8 | Unicode-3.0 |
| zerovec-derive | 0.11.6 | Unicode-3.0 |
| zlib-rs | 0.6.8 | Zlib |
| zmij | 1.0.23 | MIT |

</details>

## 5. 版本庫裡的其他資產

| 項目 | 狀況 |
|---|---|
| 桌面版圖示（`apps/desktop/app-icon.png` 與 `src-tauri/icons/`） | **來源沒有記錄**，需要確認是自己做的、還是 Tauri 範本的預設圖示；對外散佈前要確認。 |
| PDF 的中文字型 | 程式**不附帶字型**：使用者在「PDF 字型」選自己電腦上的 `.ttf`／`.ttc`，程式只把用到的字形切出來嵌進輸出的 PDF。字型的授權由使用者自己對所選的字型負責。 |
| 測試與驗證用的 STEP 檔（`tests/fixtures/step/`） | 由本專案的程式自己產生（README 有記錄來源）。 |
| SolidWorks 樣本檔（`.SLDASM` 等） | **不在版本庫裡**，也不應放進來（專有檔案）。 |
| 程式碼裡「SolidWorks」「FeatureManager」「PropertyManager」等字樣 | 這是商標問題，不是第三方程式碼；見對話中的風險盤點，對外散佈前要改成自己的名稱（尚未處理）。 |

## 6. 尚未確認的事

1. 本專案自己的授權（現在沒有 `LICENSE`）。
2. 網頁版打包輸出裡，LGPL 的 WASM 是否仍是可替換的獨立檔案。
3. libcascade 二進位內含的其他函式庫與它們的授權。
4. 桌面版圖示的來源。
5. 完整的 Rust 授權文字（`cargo about` 之類）。
6. 說明文字（`packages/i18n/src/*/help.ts`）與 SolidWorks 說明文件的相似度，尚未逐段比對。

