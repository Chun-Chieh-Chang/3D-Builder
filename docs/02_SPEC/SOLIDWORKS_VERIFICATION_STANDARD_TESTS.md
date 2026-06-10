# 自動化測試要求

> **子文件**: 接續 `SOLIDWORKS_VERIFICATION_STANDARD.md` 第 5 節。

---

## 5. 自動化測試要求

### 5.1 測試分層架構

```
tests/
├── unit/           # 單元測試 — 演算法、求解器、API
├── integration/    # 整合測試 — 前後端 IPC、檔案 I/O
├── golden/         # 黃金測試 — 與 SolidWorks 對齊的驗證
├── regression/     # 回歸測試 — 已有功能的長期穩定
├── benchmarks/     # 效能基準 — 性能回歸檢測
└── e2e/            # 端到端測試 — 完整使用者流程
```

### 5.2 測試覆蓋率要求

| Phase | 單元測試覆蓋率 | Golden Tests | 回歸測試數量 |
|-------|--------------|-------------|-------------|
| Phase 0 | > 80% | 0 | 0 |
| Phase 1 | > 85% | 3 | 5 |
| Phase 2 | > 90% | 10 | 20 |
| Phase 3+ | > 92% | 30+ | 50+ |
| Phase 5+ | > 95% | 50+ | 100+ |

### 5.3 測試命名規範

```
test_<module>_<scenario>_<expected>.py/ts
```

Examples:
- `test_sketch_constraint_coincident_valid.py`
- `test_extrude_double_direction_asymmetric.ts`
- `test_golden_l_bracket_volume_matches_sw.py`

### 5.4 黃金測試自動化流程

```python
# 示例：Golden Test 自動化框架
def run_golden_test(feature_name: str):
    # 1. 載入 SolidWorks 參考檔案
    sw_result = load_solidworks_result(f"golden/{feature_name}/solidworks_step.step")
    
    # 2. 載入 3D-Builder 參考實現
    our_result = load_3d_builder_result(f"golden/{feature_name}/golden_part.3dbpart")
    
    # 3. 載入規格定義
    spec = load_spec(f"golden/{feature_name}/golden_spec.json")
    
    # 4. 比對拓撲
    assert our_result.faces == spec.topology.faces
    assert our_result.edges == spec.topology.edges
    assert our_result.vertices == spec.topology.vertices
    
    # 5. 比對質量屬性（容差內）
    assert_volume_match(our_result.volume, spec.mass_properties.volume_cm3, ppm=1)
    assert_cog_match(our_result.cog, spec.mass_properties.center_of_gravity_mm, mm=0.001)
    
    print(f"✅ Golden Test passed: {feature_name}")
```

### 5.5 CI/CD 門禁

所有 PR 必須通過：
1. `npx tsc --noEmit` — TypeScript 型別檢查
2. `npm run test:unit` — 單元測試
3. `npm run test:golden` — 黃金測試
4. `npm run pdca:check` — PDCA 文件檢查
