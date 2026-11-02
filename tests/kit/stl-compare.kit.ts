/**
 * STL comparison files for a viewer (ADR 0221): what this program's STL export writes, to be opened in eDrawings (or a slicer) by the user, because reading
 * them back with OCCT only shows that OCCT reads them (AGENTS.md 2026-10-27). Written to `KIT_OUT` (default `D:\3DB實機確認`), folder `STL對照`, by
 *
 *   npx vitest run --config tests/kit/vitest.kit.config.ts stl-compare
 *
 * Each file is read back by this program's reader before it is kept; the numbers in the list are the kernel's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStl } from '@3db/model';
import { readPartFile, writeStl, writeZip } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

const OUT = join(process.env.KIT_OUT ?? 'D:\\3DB實機確認', 'STL對照');
let kernel: Kernel;
let solver: PlaneGcsSolver;
const made: ShapeId[] = [];
const list: string[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  mkdirSync(OUT, { recursive: true });
});
afterAll(() => made.forEach((id) => kernel.release(id)));

async function golden(name: string): Promise<ShapeId> {
  const file = await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${name}`, import.meta.url))));
  const regen = new Regenerator(kernel, solver);
  const shape = kernel.copy(regen.rebuild(file.doc).body!.shape);
  regen.dispose();
  made.push(shape);
  return shape;
}

const f = (x: number) => x.toFixed(3);
function keep(file: string, bytes: Uint8Array, unit: 'mm' | 'inch', look: string): void {
  const m = parseStl(bytes, unit);
  expect(m.closed).toBe(true);
  writeFileSync(join(OUT, file), bytes);
  const size = m.max.map((x, i) => f((x - m.min[i]!) / (unit === 'inch' ? 25.4 : 1))).join(' × ');
  list.push(`## ${file}\n\n- ${m.format === 'binary' ? '二進位' : 'ASCII'}，單位 ${unit}，${m.indices.length / 3} 個三角形\n- 外框（檔案裡的數字）：${size} ${unit}\n- 體積約 ${f(m.volume / (unit === 'inch' ? 25.4 ** 3 : 1))} ${unit}³\n- 請看：${look}\n`);
}

describe('STL comparison files (ADR 0221)', () => {
  it('writes the files and the list of what to look at', async () => {
    const plate = await golden('locating-plate.3dbx');
    const pin = await golden('diamond-pin.3dbx');
    const vblock = await golden('v-block.3dbx');
    const fine = { relative: 1e-4, angular: 0.1 };
    keep('A_定位板_二進位_mm.stl', writeStl([kernel.mesh(plate, fine)], '定位板'), 'mm', '形狀完整、沒有破洞或缺面。不必量外框：STL 只有三角形，沒有面與邊，eDrawings 點選會選到整個模型；外框數字已由本程式與 OCCT 的讀取器核對');
    keep('B_定位板_ASCII_mm.stl', writeStl([kernel.mesh(plate, fine)], '定位板', { format: 'ascii' }), 'mm', '和 A 完全一樣（ASCII 文字檔）');
    keep('C_定位板_二進位_inch.stl', writeStl([kernel.mesh(plate, fine)], '定位板', { unit: 'inch' }), 'inch', 'eDrawings 若當成 mm 開，會小 25.4 倍；這是 STL 沒有單位的正常現象，請只確認形狀與比例');
    keep('D_削邊銷_二進位_細.stl', writeStl([kernel.mesh(pin, fine)], '削邊銷'), 'mm', '圓柱與倒角是否平順、沒有裂縫');
    keep('E_V型塊_二進位_粗.stl', writeStl([kernel.mesh(vblock, { relative: 2e-3, angular: 0.5 })], 'V型塊'), 'mm', '粗網格：圓弧看得出多邊形的稜是正常的');
    const zip = await writeZip([
      { name: '定位板.stl', data: writeStl([kernel.mesh(plate)], '定位板') },
      { name: '削邊銷.stl', data: writeStl([kernel.mesh(pin)], '削邊銷') },
    ]);
    writeFileSync(join(OUT, 'F_兩個本體.zip'), zip);
    list.push('## F_兩個本體.zip\n\n- 「每個本體各存一個檔」的打包方式：解壓後應有「定位板.stl」與「削邊銷.stl」兩個檔，各自能開\n');
    writeFileSync(join(OUT, '看圖清單.md'), `# STL 對照檔（ADR 0221）\n\n用 eDrawings 開每個 .stl。數字是本程式的核心算的。\n\n${list.join('\n')}`);
    expect(list).toHaveLength(6);
  });
});
