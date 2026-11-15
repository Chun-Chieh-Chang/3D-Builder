---
name: photo-to-cad
description: 使用者提供零件或組件照片，想在 3D-Builder 重建可編輯的幾何、拆件清單、原生特徵與組立關係時使用。
disable-model-invocation: true
argument-hint: "[零件或組件名稱、照片與已知尺寸（mm）]"
---

# 從照片建模

使用者提供的尺寸與要求：

$ARGUMENTS

讀取[共用照片建模流程](../../../docs/photo-to-cad.md)。單一零件依「給 Agent 的建模流程」操作；組件依「從組件照片拆件與還原組立」操作。拆件證據、經確認的尺寸和實例 ID 同時用於 Anatomy 示意及 CAD 建模。沒有照片或關鍵配合證據時，先回傳所缺的視角與尺寸。
