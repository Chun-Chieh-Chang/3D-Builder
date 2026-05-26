---
name: typescript-safe-coder
description: 專門避免 TypeScript 紅色波浪曲線的安全程式碼撰寫技能
---

# TypeScript 安全程式碼撰寫技能

## 🔥 核心原則

這個技能的唯一目的：**0 紅色波浪曲線！**

---

## 📋 撰寫前的檢查清單

每次撰寫或修改 TypeScript 程式碼之前，務必先執行以下步驟：

### 1. 閱讀原始檔案
- **務必先使用 `Read` 工具讀取**要修改的檔案**完整內容**
- 絕對不要直接 `Edit` 而沒有先 `Read`
- 檢查現有的型別定義、介面、常數

### 2. 檢查型別定義
- 查看同一個檔案或相關的 `*.d.ts 或 Store 檔案
- 特別注意：
  - 物件有哪些屬性
  - 函式的參數和回傳值
  - 常數和列舉值

### 3. 遵循現有模式
- 複製貼上並修改，而不是從頭寫
- 檢查該專案中是否有類似功能的程式碼
- 遵循相同的型別模式

---

## 🛡️ 常見 TypeScript 錯誤預防策略

### 策略 A：可選屬性的安全處理

**錯誤模式：
```typescript
const x = obj.maybeUndefined.prop;  // ❌ 可能為 undefined
```

**安全模式：
```typescript
// 方法 1：先檢查是否存在
if (obj.maybeUndefined) {
  const x = obj.maybeUndefined.prop; // ✅
}

// 方法 2：使用 && 或 ?? 有值時才存取
const x = obj.maybeUndefined?.prop; // ✅

// 方法 3：使用 ?? 提供預設值
const x = obj.maybeUndefined ?? defaultValue; // ✅
```

---

### 策略 B：`any` 型別的安全處理

當您不確定型別時，不要隨便存取屬性，請：

1. 先宣告 `as any`：
```typescript
const safeObj = obj as any;
```

2. 加上安全檢查：
```typescript
if (safeObj.someProperty) {
  // 安全操作
}
```

3. 選擇性鏈：
```typescript
if (safeObj?.someProperty?.nestedProperty) {
  // 安全操作
}
```

---

### 策略 C：Store 狀態的安全處理

特別注意 Zustand Store 中存取狀態：
```typescript
// 永遠先解構，再使用
const { someState, someFunction } = useCadStore();

// 檢查狀態是否存在
if (someState) {
  // 使用
}
```

---

### 策略 D：三維/Three.js 控制元件的安全處理

對於 `controls`、`object`、`target` 這類：

```typescript
if (controls) {
  const c = controls as any;
  if (c.target) {
    c.target.set(0, 0, 0);
  }
  if (c.object && c.object.position) {
    c.object.position.set(30, 30, 30);
  }
  if (c.update) {
    c.update();
  }
}
```

---

### 策略 E：陣列索引的安全處理

```typescript
// ❌ 不安全
const item = arr[0].prop;

// ✅ 安全
if (arr.length > 0 && arr[0]) {
  const item = arr[0].prop;
}
```

---

## ✅ 修改後的強制檢查

每次完成 `Edit` 或 `Write` 後，**務必執行以下檢查**：

### 1. 型別檢查清單
- [ ] 所有物件存取都有安全檢查嗎？
- [ ] 可選屬性都有 `?.` 或 `if` 檢查嗎？
- [ ] 不確定型別時有用 `as any` 嗎？
- [ ] 有檢查物件存在才呼叫函數嗎？

### 2. 使用診斷工具
修改完成後，使用 `GetDiagnostics` 工具檢查：
```typescript
GetDiagnostics 檢查是否有新的錯誤
```

---

## 🎯 這個技能的口訣

**Read First, Then Edit, Then Read Again!**

1. **先 Read**：永遠先讀取
2. **再 Edit**：根據閱讀結果修改
3. **最後檢查**：確保沒有紅色波浪
4. **重複**：直到 0 錯誤！

---

## 🔧 工具調用順序

每次任務開始時，優先使用：

1. `Read`（絕對不能跳過！）
2. `Grep`（找類似程式碼
3. `Edit`（小心修改）
4. `GetDiagnostics`（檢查是否有錯誤）
5. 有錯誤 → 回到步驟 1，重新來過！
