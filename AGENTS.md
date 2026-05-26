<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:typescript-safe-coder-rules -->
# TypeScript 安全程式碼撰寫規則（零紅色波浪）

## 🔴 第一原則：零紅色波浪曲線

每次撰寫或修改 TypeScript 程式碼的**唯一目標**：0 紅色波浪曲線！

---

## 📋 撰寫前的強制流程

### 步驟 1：永遠先 Read！（絕對不能跳過）
- **禁止直接 Edit**，必須先使用 `Read` 工具讀取完整內容
- 檢查現有的型別定義、介面、常數
- 了解該檔案既有的程式碼風格

### 步驟 2：檢查型別定義
- 查看 `*.d.ts`、Store 或相關檔案
- 確認：
  - 物件有哪些屬性
  - 函式的參數和回傳值
  - 常數和列舉值

### 步驟 3：遵循現有模式
- 複製貼上並修改，而不是從頭寫
- 檢查該專案中是否有類似功能的程式碼

---

## 🛡️ 常見安全模式

### 1. 可選屬性的安全處理
```typescript
// ❌ 不安全
const x = obj.maybeUndefined.prop;

// ✅ 安全
if (obj.maybeUndefined) {
  const x = obj.maybeUndefined.prop;
}
```

### 2. `any` 型別的安全處理
```typescript
const safeObj = obj as any;
if (safeObj?.someProperty) {
  // 安全操作
}
```

### 3. Store 狀態的安全處理
```typescript
const { someState } = useCadStore();
if (someState) {
  // 使用
}
```

### 4. 三維/Three.js 控制元件
```typescript
if (controls) {
  const c = controls as any;
  if (c.target) { c.target.set(0, 0, 0); }
  if (c.object?.position) { c.object.position.set(30, 30, 30); }
  if (c.update) { c.update(); }
}
```

---

## ✅ 修改後的強制檢查

每次 `Edit` 或 `Write` 後，**務必使用 `GetDiagnostics` 檢查**，確認沒有任何紅色波浪！

如有錯誤 → 回到步驟 1，重新閱讀、重新修改！

---

## 🔗 品質把關連動機制

### 完整流程
```
Read → Check Type → Edit → GetDiagnostics → 確認零錯誤
  ↓        ↓          ↓           ↓                  ↓
  永遠    確認型別    修改       零紅色波浪       通過
```

### 失敗後的強制重做
| 失敗點 | 重做動作 |
|---|---|
| Read 跳過 | 停止，強制 Read |
| GetDiagnostics 有錯誤 | 回到步驟 1，重新來過 |

### 品質門檻
**任何一關不通過，不論什麼理由，都必須重做！**

---

## 🛠️ NPM 品質檢查腳本

每次修改完成後，可執行：
```bash
npm run pdca:full
```

這會自動執行：
1. TypeScript 型別檢查 (`tsc --noEmit`)
2. PDCA 循環檢查
<!-- END:typescript-safe-coder-rules -->
