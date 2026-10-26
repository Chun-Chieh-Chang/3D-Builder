import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Node maintenance scripts expose plain ESM without declaration files.
import { uiJobs } from '../../scripts/ui-jobs.mjs';
// @ts-expect-error Node maintenance scripts expose plain ESM without declaration files.
import { documentRole, inventoryMarkdown, localLinkProblems, markdownLinks } from '../../scripts/check-repository.mjs';
const temporary:string[]=[];
afterEach(()=>{for(const path of temporary.splice(0))rmSync(path,{recursive:true,force:true});});
function directory(){const p=mkdtempSync(join(tmpdir(),'3db-repo-audit-'));temporary.push(p);return p;}
it('uses the runner discovery contract: sorted scripts, header only, deduplicated calls and excluded helpers',()=>{
 const dir=directory();writeFileSync(join(dir,'b.js'),'// await __b.run();\r\n// await __b.run();\r\n// await __sub.helper();\r\n');writeFileSync(join(dir,'a.js'),'// await __a.first();\n// await __a.second();\n');writeFileSync(join(dir,'manual-support.js'),'// await __bad.run();');writeFileSync(join(dir,'empty.js'),'\n'.repeat(40)+'// await __late.run();');
 expect(uiJobs(dir)).toEqual([{file:'a.js',calls:['__a.first','__a.second']},{file:'b.js',calls:['__b.run']},{file:'empty.js',calls:[]}]);expect(uiJobs(dir,/^b/)).toEqual([{file:'b.js',calls:['__b.run']}]);
});
it('ignores fenced and inline code examples while preserving link diagnostic line numbers',()=>{
 const md='```md\n[example](not-a-file)\n```\n`[inline](ignored)`\n[real](<file with space.md>)\n[web](https://example.com/)';
 expect(markdownLinks(md)).toEqual([{target:'file with space.md',line:5},{target:'https://example.com/',line:6}]);
});
it('rejects bad case on every OS and accepts Unicode, encoded space and a local fragment target',()=>{
 const root=directory();mkdirSync(join(root,'docs'));writeFileSync(join(root,'docs','真實 File.md'),'# Heading');
 expect(localLinkProblems(root,'docs/source.md','[ok](%E7%9C%9F%E5%AF%A6%20File.md#heading)')).toEqual([]);expect(localLinkProblems(root,'docs/source.md','[bad](<真實 file.md>)')).toHaveLength(1);
});
it('fails closed on missing, absolute, escaping or invalid-encoded local targets, without checking remote URLs',()=>{
 const root=directory();mkdirSync(join(root,'docs'));
 expect(localLinkProblems(root,'docs/a.md','[missing](gone.md)\n[escape](../../x.md)\n[absolute](/etc/passwd)\n[bad](%ZZ)')).toHaveLength(4);expect(localLinkProblems(root,'docs/a.md','[web](https://example.com/x)\n[mail](mailto:a@example.com)\n[here](#heading)')).toEqual([]);
});
it('requires a single explicit role for new documents and distinguishes proposals from current claims',()=>{
 expect(documentRole('docs/project-state.md')).toBe('產品現況');expect(documentRole('docs/adr/0203-example.md')).toBe('架構決策');expect(documentRole('docs/design/menu-redesign/plan.md')).toBe('設計提案');expect(documentRole('docs/phase3-plan.md')).toBe('階段計畫快照');expect(()=>documentRole('wiki/unreviewed.md')).toThrow(/owner\/role/);
});
it('materializes measured counts without treating inventory as a passing acceptance report',()=>{
 const facts={schemas:{part:84,assembly:7,drawing:30},workspaces:[],adrCount:202,ui:{files:185,scripts:181,calls:228},manualItems:91,wiki:false,scripts:[['dev','vite']],documents:[{file:'README.md',title:'入口',role:'入口'}],duplicateFiles:[],dependencies:[],cargoLockPackages:417};
 const output=inventoryMarkdown(facts);expect(output).toContain('84／7／30');expect(output).toContain('185／181／228');expect(output).toContain('不代表本版全部驗證通過');expect(output).toContain('(<../README.md>)');expect(output).not.toContain('/workspace/');
});
