import { readFileSync } from 'node:fs';
import { beforeAll, it, expect } from 'vitest';
import { parsePart } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

it('tests 2D sketch fillet for sketch6', () => {
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:front' };
  }

  // 分析 sketch6
  const sk6 = doc.features.find((f) => f.id === 'sketch6') as any;
  console.log('sk6 original entities count:', sk6.entities.length);
  console.log('sk6 original constraints count:', sk6.constraints.length);

  // 我們要倒角的是直線 x = 1.355 與圓 x^2 + y^2 = 3.125^2 的內角。
  // 直線方程式：x = x0 (例如 1.355)
  // 圓弧方程式：x^2 + y^2 = R^2 (R = 3.125)
  // 倒角半徑 r = 0.3。
  // 倒角圓圓心 (xc, yc)：
  // 1. 與直線 x = 1.355 相切（在內側，即 x < 1.355，因為切刀在外面）：
  //    切刀的材料是去除外側還是內側？
  //    看 sketch6：切刀切除的是耳朵兩側，耳朵寬度是 2.71 (x 從 -1.355 到 +1.355)！
  //    工件實體在 x 位於 [-1.355, 1.355] 之間！
  //    所以工件的內角圓角，圓心必須在工件實體內部（即 |x| < 1.355，且 x^2 + y^2 < R^2）！
  //    或者如果是切刀的輪廓，工件凸耳的「內角」，在切刀草圖上就是切刀輪廓的「外角」還是「內角」？
  //    我們來仔細確認切刀輪廓是挖掉哪裡！
});
