// await __featureEditor.floating();
// await __featureEditor.drag();
// await __featureEditor.cutDrag();
// await __featureEditor.assembly();
// await __featureEditor.guards();
// await __featureEditor.datum();
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H,B=await import(`${root}tests/phase1/builders.ts`),io=await import(`${root}packages/io/src/index.ts`);
const M=window.__featureEditor={},state=()=>store.getState(),feature=()=>state().doc.features.find(f=>f.id==='e');
const must=(x,why)=>{if(!x)throw new Error(why);};
const fixture=(solid=true)=>B.build(B.sketch('s',B.front,B.rectangle('r',0,0,30,20)),...(solid?[B.extrude('e','s','boss',{type:'blind',depth:'10'})]:[]));
async function ready(){await H.wait(100);await H.waitFor(()=>!state().rebuilding&&state().result,20000,'native rebuild');must(!state().result.features.some(f=>f.status==='error'),JSON.stringify(state().result.features));}
async function setup(solid=true){H.ready();if(state().recovery)store.discardRecovery();await H.project({});await H.writeAt('編輯件.3dbx',await io.writePartFile(fixture(solid)));await H.open('編輯件.3dbx');await ready();}
async function volume(n){await H.waitFor(()=>!state().rebuilding&&Math.abs((state().result?.mass?.volume??-1)-n)<1e-5,10000,'native volume '+n);}
function input(label){const row=[...document.querySelectorAll('[data-floating-parameters] .pm-row')].find(r=>r.querySelector('span')?.textContent===label);must(row,'field '+label);return row.querySelector('input');}
function type(el,value){el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}
async function apply(){await H.waitFor(()=>!state().rebuilding&&document.querySelector('[data-floating-parameters] .pm-ok')&&!document.querySelector('[data-floating-parameters] .pm-ok').disabled,5000,'Apply enabled');document.querySelector('[data-floating-parameters] .pm-ok').click();try{await H.waitFor(()=>!state().editing,5000,'edit committed');}catch(e){throw new Error(e.message+' '+JSON.stringify({rebuilding:state().rebuilding,invalid:[...document.querySelectorAll('[data-floating-parameters] [aria-invalid=true]')].map(x=>x.outerHTML),button:document.querySelector('[data-floating-parameters] .pm-ok')?.outerHTML,notice:state().notice,features:state().result.features}));}await ready();}
async function edit(){const row=await H.treeClick('e');row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await H.waitFor(()=>document.querySelector('[data-floating-parameters]'),5000,'floating editor');}
M.floating=async()=>{
 await setup();await edit();must(document.querySelectorAll('[data-floating-parameters]').length===1,'one editor');const box=document.querySelector('[data-floating-parameters]').getBoundingClientRect();must(box.right<=innerWidth&&box.bottom<=innerHeight,'card within viewport');
 type(input('深度'),'6*3');await volume(10800);must(feature().dir1.depth==='6*3','expression preserved live');await window.__shot?.('floating-expression-preview');await apply();store.undo();await volume(6000);store.redo();await volume(10800);
 await edit();type(input('深度'),'2*');await H.wait(350);must(input('深度').getAttribute('aria-invalid')==='true','invalid expression marked');must(document.querySelector('[data-floating-parameters] .pm-ok').disabled,'invalid prevents Apply');document.querySelector('[data-floating-parameters] .pm-cancel').click();await volume(10800);must(feature().dir1.depth==='6*3','cancel restores expression');
 await edit();type(input('深度'),'12');await volume(7200);document.querySelector('[data-direction-mode="symmetric"]').click();await ready();must(feature().dir1.type==='midPlane'&&!feature().dir2,'symmetric real params');await volume(7200);document.querySelector('[data-direction-mode="two"]').click();await volume(14400);must(feature().dir2?.depth==='12','second direction');document.querySelector('[data-direction-mode="one"]').click();await volume(7200);
 document.querySelector('.parameter-dock').click();await H.waitFor(()=>!document.querySelector('[data-floating-parameters]'),5000,'docked');document.querySelector('[data-action="float-parameters"]').click();await H.waitFor(()=>document.querySelector('[data-floating-parameters]'),5000,'floating again');await window.__shot?.('floating-parameter-card');await apply();return{pass:true,liveVolume:10800,invalidRejected:true};
};
M.drag=async()=>{
 await setup(false);await H.treeClick('s');await H.action('特徵','伸長填料/基材');await ready();const f=state().doc.features.find(f=>f.type==='extrude');must(f,'new extrude');const button=await H.waitFor(()=>document.querySelector('[data-action="drag-extrude-preview"]'),5000,'construction handle');must(!button.disabled,'numeric depth draggable');const depth=Number(f.dir1.depth),v=store.viewer,frame=state().result.frames.get('s'),center=state().result.faceFingerprints[state().result.faceNames.indexOf(`${f.id}:cap:end`)].center;
 const a=v.screenPoint(center),b=v.screenPoint(center.map((x,i)=>x+frame.normal[i]));let axis=[b[0]-a[0],b[1]-a[1]];if(Math.hypot(...axis)<1e-4)axis=[0,-1/v.pixelSize()];const r=button.getBoundingClientRect(),from=[r.x+r.width/2,r.y+r.height/2],pid=71;
 const send=(target,event,delta)=>target.dispatchEvent(new PointerEvent(event,{bubbles:true,cancelable:true,pointerId:pid,button:0,buttons:event==='pointerup'?0:1,clientX:from[0]+axis[0]*delta,clientY:from[1]+axis[1]*delta}));
 send(button,'pointerdown',0);send(window,'pointermove',5);await volume(600*(depth+5));must(state().editing&&Number(state().doc.features.find(x=>x.id===f.id).dir1.depth)===depth+5,'native preview before release');await window.__shot?.('live-drag-before-release');send(window,'pointermove',-depth-4);await volume(2400);must(state().doc.features.find(x=>x.id===f.id).dir1.reverse,'crossing plane reverses');send(window,'pointerup',-depth-4);await apply();store.undo();await ready();must(!state().doc.features.some(x=>x.id===f.id),'single undo removes whole creation');store.redo();await volume(2400);
 const row=await H.treeClick(f.name);row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await H.waitFor(()=>state().editing,5000,'edit again');await ready();const btn=document.querySelector('[data-action="drag-extrude-preview"]');send(btn,'pointerdown',0);await H.wait(50);send(window,'pointermove',-2);await volume(3600);must(store.cancelFeatureGesture,'gesture cancellation registered');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await volume(2400);must(state().editing,'Escape restores only gesture');document.querySelector('[data-floating-parameters] .pm-cancel').click();await volume(2400);return{pass:true,beforeRelease:true,reversed:true,undo:true,cancel:true};
};
/** 除料也要能用同一支操控器：拖進材料加深、跨面翻反向、反向切到空氣時如實報告。 */
M.cutDrag=async()=>{
 H.ready();if(state().recovery)store.discardRecovery();await H.project({});
 // 方塊 30 × 20 × 30，頂面一張草圖：建構伸長除料（預設盲深 10 往材料內切）
 const parts=[B.sketch('s',B.front,B.rectangle('r',0,0,30,20)),B.extrude('e','s','boss',{type:'blind',depth:'30'}),B.sketch('s2',B.face('e:cap:end'),B.rectangle('r2',0,0,30,20))];
 await H.writeAt('除料件.3dbx',await io.writePartFile(B.build(...parts)));
 await H.open('除料件.3dbx');await ready();
 const block=18000;
 await H.treeClick('s2');await H.action('特徵','伸長除料');
 const f=await H.waitFor(()=>{const x=state().doc.features.find(y=>y.type==='extrude'&&y.op==='cut');return x&&state().result&&!state().rebuilding?x:null;},20000,'cut created');
 const button=await H.waitFor(()=>document.querySelector('[data-action="drag-extrude-preview"]'),5000,'cut constructor handle');
 must(!button.disabled,'numeric depth draggable');
 const depth=Number(f.dir1.depth),v=store.viewer,frame=state().result.frames.get('s2'),center=state().result.faceFingerprints[state().result.faceNames.indexOf(`${f.id}:cap:end`)]?.center;
 must(center,'the cut end cap is named');
 // 除料的正值軸朝材料內（與法向相反）：操控器掛箭頭的同一個映射
 const a=v.screenPoint(center),b=v.screenPoint(center.map((x,i)=>x-frame.normal[i])),len=Math.hypot(b[0]-a[0],b[1]-a[1]);
 let axis=len<1e-4?[0,1/v.pixelSize()]:[(b[0]-a[0])/len,(b[1]-a[1])/len];
 const r0=button.getBoundingClientRect(),from=[r0.x+r0.width/2,r0.y+r0.height/2],pid=91;
 const send=(target,event,delta)=>target.dispatchEvent(new PointerEvent(event,{bubbles:true,cancelable:true,pointerId:pid,button:0,buttons:event==='pointerup'?0:1,clientX:from[0]+axis[0]*len*delta,clientY:from[1]+axis[1]*len*delta}));
 send(button,'pointerdown',0);send(window,'pointermove',5);
 await volume(block-30*20*(depth+5));
 must(state().editing&&state().doc.features.find(x=>x.id===f.id).dir1.depth===String(depth+5),'native preview before release');
 // 拖曳不放開時，掛在端面的把手要跟著指標 1:1 走（除料的痛點：以前會反向跑掉）
 const r1=button.getBoundingClientRect(),at=[r1.x+r1.width/2,r1.y+r1.height/2],along=(at[0]-from[0])*axis[0]+(at[1]-from[1])*axis[1];
 must(along>0.5*len*5&&along<1.5*len*5,'handle follows the pointer into the material, not away from it');
 await window.__shot?.('cut-drag-deepen');
 send(window,'pointermove',-(depth+4)); // 跨過草圖平面：正向除料反向，切到材料外
 await H.waitFor(()=>{const d=state().doc.features.find(x=>x.id===f.id);return d.dir1.type==='blind'&&!!d.dir1.reverse;},5000,'crossing the plane reverses the cut');
 await H.waitFor(()=>!state().rebuilding&&state().result?.features.find(x=>x.id===f.id)?.status==='error',10000,'reversed cut into air fails');
 must(JSON.stringify(state().result.features.find(x=>x.id===f.id)).includes('除料沒有移除任何材料'),'the failure names the removal honestly');
 must(!document.querySelector('[data-action="drag-extrude-preview"]'),'handle hides while the reversed cut has no end cap');
 await window.__shot?.('cut-drag-reversed-error');
 send(window,'pointermove',5); // 拉回正向：恢復可以套用的除料
 await volume(block-30*20*(depth+5));
 must(!state().result.features.some(x=>x.status==='error'),'pulling back clears the error');
 send(window,'pointerup',5);await apply();await ready();await volume(block-30*20*(depth+5));
 store.undo();await ready();must(!state().doc.features.some(x=>x.id===f.id),'single undo removes the whole creation');store.redo();await volume(block-30*20*(depth+5));
 // 編輯既有除料：拖曳加深、Esc 只還原手勢
 const row=await H.treeClick(f.name);row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
 await H.waitFor(()=>state().editing,5000,'edit again');await ready();
 const btn=document.querySelector('[data-action="drag-extrude-preview"]');must(btn&&!btn.disabled,'edit handle');
 send(btn,'pointerdown',0);await H.wait(50);
 send(window,'pointermove',-2);await volume(block-30*20*(depth+3));
 must(store.cancelFeatureGesture,'gesture cancellation registered');
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 await volume(block-30*20*(depth+5));must(state().editing,'Escape restores only the gesture');
 document.querySelector('[data-floating-parameters] .pm-cancel').click();await volume(block-30*20*(depth+5));
 await H.tidy();
 return{pass:true,deepen:true,tracking:Math.round(along*10)/10,reversedFails:true,undo:true,escape:true};
};

M.assembly=async()=>{
 await setup();await H.action('檔案','新組合件');if(state().folderRequest)await H.modalButton('選擇資料夾…');const c=await H.insert('編輯件.3dbx');await H.insert('編輯件.3dbx',[.8,.7]);await H.loaded();await H.save('編輯組合.3dba');
 async function open(id,context=false){const twist=document.querySelector(`[data-twisty="${c.id}"]`);if(!document.querySelector(`[data-component-feature="${c.id}:${id}"]`))twist.click();const row=await H.waitFor(()=>document.querySelector(`[data-component-feature="${c.id}:${id}"]`),5000,'assembly feature row');if(context){row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:300}));await H.wait(50);document.querySelector('[data-action="edit-component-feature"]').click();}else row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await H.waitFor(()=>!state().asm&&state().editing?.featureId===id,20000,'source edit '+id);await ready();}
 async function back(expected){await H.save('編輯件.3dbx');document.querySelector('[data-action="returnBack"]').click();await H.loaded();must(state().asm.doc.components.length===2,'both instances retained');for(const x of state().asm.doc.components){const build=store.assembly.buildOf(x.id);must(build?.mass&&Math.abs(build.mass.volume-expected)<1e-5,'source updates instance '+x.id+' '+JSON.stringify(build?.mass));}}
 await open('e');must(document.querySelector('[data-floating-parameters]'),'assembly feature opens same editor');type(input('深度'),'15');await volume(9000);await apply();await back(9000);
 await open('s',true);must(state().editing.kind==='sketch'&&state().result.frames.has('s'),'source sketch frame ready');must(store.setDimensionValue('rw','40'),'change sketch dimension');await H.settle();document.querySelector('.property-manager .pm-ok').click();await volume(12000);await back(12000);await window.__shot?.('assembly-source-edit-return');return{pass:true,instances:2,featureVolume:9000,sketchVolume:12000};
};

M.guards=async()=>{
 await setup();await edit();document.querySelector('[data-direction-mode="symmetric"]').click();await ready();await volume(6000);
 const button=document.querySelector('[data-action="drag-extrude-preview"]');must(button&&!button.disabled,'symmetric handle');const v=store.viewer,r=button.getBoundingClientRect(),p=state().result.faceFingerprints[state().result.faceNames.indexOf('e:cap:end')].center,normal=state().result.frames.get('s').normal,a=v.screenPoint(p),b=v.screenPoint(p.map((x,i)=>x+normal[i]));let axis=[(b[0]-a[0])/2,(b[1]-a[1])/2];if(Math.hypot(...axis)<1e-4)axis=[0,-.5/v.pixelSize()];const from=[r.x+r.width/2,r.y+r.height/2];
 const send=(target,type,delta)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:82,button:0,buttons:type==='pointerup'?0:1,clientX:from[0]+axis[0]*delta,clientY:from[1]+axis[1]*delta}));
 send(button,'pointerdown',0);send(window,'pointermove',4);await volume(8400);const q=state().result.faceFingerprints[state().result.faceNames.indexOf('e:cap:end')].center;must(Math.abs(q.reduce((sum,x,i)=>sum+(x-p[i])*normal[i],0)-2)<1e-6,'symmetric cap moves half total depth');send(window,'pointercancel',4);await volume(6000);must(state().editing&&!store.cancelFeatureGesture,'pointercancel clears gesture and restores geometry');
 type(input('深度'),'2*5');await H.waitFor(()=>feature().dir1.depth==='2*5'&&!state().rebuilding,10000,'expression applied');await H.wait(100);must(document.querySelector('[data-action="drag-extrude-preview"]').disabled,'driver expression protected');const field=input('深度'),suffix=field.parentElement.querySelector('.suffix'),style=getComputedStyle(field);must(parseFloat(style.paddingRight)>=suffix.getBoundingClientRect().width+8,'numeric text reserves unit space');await window.__shot?.('symmetric-expression-guard');document.querySelector('[data-floating-parameters] .pm-cancel').click();await volume(6000);await H.tidy();return{pass:true,symmetricCapDelta:2,pointerCancel:true,expressionProtected:true};
};
M.datum=async()=>{
 H.ready();if(state().recovery)store.discardRecovery();await H.project({});const d=B.build({id:'p',type:'refPlane',name:'offset',suppressed:false,def:{mode:'offset',plane:B.front,distance:'7'}},B.sketch('s',{kind:'datum',name:'p'},B.rectangle('r',0,0,30,20)),B.extrude('e','s','boss',{type:'blind',depth:'10'}));await H.writeAt('基準面件.3dbx',await io.writePartFile(d));await H.open('基準面件.3dbx');await ready();await H.action('檔案','新組合件');if(state().folderRequest)await H.modalButton('選擇資料夾…');const c=await H.insert('基準面件.3dbx');await H.loaded();await H.save('基準面組合.3dba');document.querySelector(`[data-twisty="${c.id}"]`).click();const row=await H.waitFor(()=>document.querySelector(`[data-component-feature="${c.id}:s"]`),5000,'datum sketch row');row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await H.waitFor(()=>state().editing?.kind==='sketch',20000,'source datum sketch edit');must(state().result.frames.has('s'),'native custom frame ready before edit');must(Math.abs(state().result.frames.get('s').origin[2]-7)<1e-6,'actual offset frame');must(store.setDimensionValue('rw','35'),'datum sketch dimension');await H.settle();document.querySelector('.property-manager .pm-ok').click();await volume(7000);await H.save('基準面件.3dbx');document.querySelector('[data-action="returnBack"]').click();await H.loaded();must(Math.abs(store.assembly.buildOf(c.id).mass.volume-7000)<1e-5,'native datum source reload');must(!state().recovery,'no dialog blocks assembly');await window.__shot?.('datum-sketch-return');return{pass:true,offset:7,volume:7000};
};
