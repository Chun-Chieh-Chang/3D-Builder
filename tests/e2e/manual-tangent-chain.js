// await __tangentChain.run();
// Real UI: a line, then 切線弧 and 直線 picked straight off the toolbar with no Escape in between — the chain is kept, the shared end is not clicked again, and Esc ends the chain.
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase1-demo-parts.js?'+Date.now());
const H=window.__ui,{store}=H;
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const geometry=()=>store.getState().sketchSolve.geometry;
/** A toolbar press: the tool changes while the chain runs on (setTool keeps it, G05/P2-6). */
const pick=async label=>{H.tab('草圖');await H.wait(50);H.btn(label);await H.wait(80);};
window.__tangentChain={run:async()=>{
 H.ready();await H.action('檔案','新零件');await H.treeClick('前基準面');await H.action('草圖','草圖');await H.frameSketch(7,5,20);
 // a line of 10 from the origin; its chain is still running
 await H.tool('直線');await H.sk(0,0);await H.sk(10,0);await H.solved();
 const line=H.sketch().entities.find(e=>e.type==='line');
 // G05 (P2-6): 切線弧 picked with the chain running asks only for the end — the start is the line's end
 await pick('切線弧');
 check(H.view().hint.includes('設定終點'),`the panel asks for the end of the tangent arc (got: ${H.view().hint})`);
 const cursor=H.toClient(14,4);H.ptr('pointermove',cursor.x,cursor.y);await H.wait(80);
 const preview=H.view().preview.filter(s=>s.kind==='arc');
 check(preview.length===1,'the tangent arc is previewed before it is made');
 check(Math.hypot(preview[0].c[0]-10,preview[0].c[1]-4)<1e-6,`the preview arc leaves the chain end along the line (center ${preview[0].c})`);
 const count=H.sketch().entities.length;
 await H.sk(10,0);await H.solved();
 check(H.sketch().entities.length===count,'a click on the point the chain starts from makes nothing');
 await H.sk(14,4);await H.solved();
 const arc=H.sketch().entities.find(e=>e.type==='arc');
 check(!!arc,'the tangent arc was made');
 const arcEnd=geometry().get(arc.end);
 check(Math.hypot(arcEnd.p[0]-14,arcEnd.p[1]-4)<1e-6,`the arc ends where it was clicked (${arcEnd.p})`);
 // 直線 picked straight after carries on from the arc's end, leaving along its tangent
 await pick('直線');
 await H.sk(14,10);await H.solved();
 const after=H.sketch(),lines=after.entities.filter(e=>e.type==='line'),arcs=after.entities.filter(e=>e.type==='arc');
 check(lines.length===2&&arcs.length===1,`two lines and one arc (got ${lines.length} lines, ${arcs.length} arcs)`);
 const second=lines.find(e=>e.id!==line.id);
 check(second.p1===arcs[0].end,`the second line starts at the arc's end (${second.p1} vs ${arcs[0].end})`);
 const tangents=after.constraints.filter(c=>c.type==='tangent');
 check(tangents.length===2,`two tangencies (got ${tangents.length})`);
 check(!['over','failed'].includes(store.getState().sketchSolve.status),'the actual solver accepts the path');
 // Esc ends the chain with nothing half-made; a second Esc leaves the tool
 await H.key('Escape');
 check(H.sketch().entities.length===after.entities.length,'Esc leaves no half-made segment');
 check(H.view().hint.includes('起點'),`the line tool asks for a start point again (got: ${H.view().hint})`);
 await H.key('Escape');
 check(H.view().tool==='select','a second Esc returns to select');
 return {pass:true,segments:['line 0,0-10,0','tangent arc to 14,4','line 14,4-14,10'],tangencies:tangents.length};
}};
