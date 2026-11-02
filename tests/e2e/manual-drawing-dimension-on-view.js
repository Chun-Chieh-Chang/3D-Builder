// await __dimensionOnView.drawing();
// A dimension line dragged onto the view is drawn on it (ADR 0227): the arrows touch the contour, no extension line is drawn, the number is the same one, and
// dragging the line off the view takes it back outside where it was.
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase1-demo-parts.js?'+Date.now());
await import(here+'phase2-assembly.js?'+Date.now());
const S=window.__ui,H=window.__ui2,{store}=H;
const check=(ok,why)=>{if(!ok)throw new Error(why);};
const near=(a,b)=>Math.abs(a-b)<0.06;
window.__dimensionOnView={drawing:async()=>{
 H.ready();await H.project({'plate.3dbx':H.GOLDEN+'locating-plate.3dbx'});await H.open('plate.3dbx');await H.waitFor(()=>store.getState().result?.mesh,20000,'real plate');await H.newDrawing();
 const d=store.drawingStore,page=()=>H.page(),state=()=>store.getState().drw;
 await H.waitFor(()=>page()?.views.length===3&&[...state().lines.values()].filter(Boolean).length===3,30000,'views');
 const view=page().views.find(v=>v.direction==='top');document.querySelector(`[data-view="${view.id}"]`).click();await H.waitFor(()=>state().features.get(view.id),30000,'actual model facts');
 const auto=document.querySelector('[data-action="autoDimension"]');check(!!auto,'auto dimension action');auto.click();await H.waitFor(()=>page().dimensions.some(x=>x.kind==='linear')&&state().elements.size,30000,'real dimension');await H.wait(150);
 // the dimension of the view that is chosen, so the properties panel shows this one
 const initial=page().dimensions.find(x=>x.kind==='linear'&&x.orientation==='horizontal'&&x.view===view.id);check(!!initial,'a horizontal linear dimension on the view');const id=initial.id;
 const dimension=()=>page().dimensions.find(x=>x.id===id);
 const outcome=()=>d.scene().dimensions.get(id),first=outcome(),value=first.value;
 const placed=d.scene().placed.get(view.id);
 const box={left:placed.at[0]-placed.w/2,right:placed.at[0]+placed.w/2,bottom:placed.at[1]-placed.h/2,top:placed.at[1]+placed.h/2};
 const client=p=>{const svg=document.querySelector('[data-svg] svg'),r=svg.getBoundingClientRect(),b=svg.viewBox.baseVal;return [r.left+p[0]/b.width*r.width,r.top+(b.height-p[1])/b.height*r.height];};
 const canvas=()=>document.querySelector('[data-drawing-canvas]');
 const drag=async(from,to)=>{const a=client(from),b=client(to);const send=(type,p)=>canvas().dispatchEvent(new PointerEvent(type,{clientX:p[0],clientY:p[1],button:0,buttons:type==='pointerup'?0:1,pointerId:19,bubbles:true}));send('pointerdown',a);for(let i=1;i<=6;i++){send('pointermove',[a[0]+(b[0]-a[0])*i/6,a[1]+(b[1]-a[1])*i/6]);await H.wait(25);}send('pointerup',b);await H.wait(200);};
 // The line of the dimension, away from its number, so the hit test has to find the line itself.
 const handle=first.handle,onLine=[handle.mid[0]+(handle.a[0]-handle.b[0])*0.25,handle.mid[1]];
 check(onLine[1]<box.bottom||onLine[1]>box.top,'the dimension line is drawn outside the view to begin with');
 // Drag the line onto the view: it is drawn on it, between the view's edges.
 await drag(onLine,[placed.at[0],placed.at[1]]);
 const on=dimension();check(on.insideAt!==undefined,'the line is drawn on the view now');check(near(outcome().value,value),'the measured number is unchanged');
 const inside=outcome().handle;check(inside.mid[1]>box.bottom&&inside.mid[1]<box.top,'the drawn line is between the edges of the view');
 const lines=outcome().items.filter(i=>i.kind==='polyline'&&!i.closed);
 check(lines.length===1,'only the dimension line is drawn on the view, no extension line');
 const onLine2=[inside.mid[0]+(inside.a[0]-inside.b[0])*0.25,inside.mid[1]];
 check(Math.abs(lines[0].points[1]-lines[0].points[3])<0.01,'the dimension line is horizontal');
 // The arrows touch the contour: the ends of the line are where the measured points are.
 check(near(lines[0].points[1],inside.a[1],0.2)||near(lines[0].points[1],inside.b[1],0.2),'an arrow touches the contour');
 // The text of the dimension is still there, with the same number.
 const text=outcome().items.find(i=>i.kind==='text');check(!!text&&text.text===first.items.find(i=>i.kind==='text').text,'the same number is written');
 // Drag it off the view again: it goes back outside, at the distance the pointer is at.
 await drag(onLine2,[onLine2[0],box.bottom-12]);
 const back=dimension();check(back.insideAt===undefined,'the line is off the view again');check(back.offset!==initial.offset,'the line is outside the view, at the distance the pointer is at');
 check(near(outcome().value,value),'the measured number is still unchanged');
 check(outcome().items.filter(i=>i.kind==='polyline'&&!i.closed).length===3,'the extension lines are drawn again');
 d.undo();await H.wait(150);
 const undone=dimension();check(undone.insideAt!==undefined,'one undo brings the line back on the view');check(undone.offset===initial.offset,'the distance outside the view is kept');
 // The properties panel puts the line on the view and takes it off again.
 d.select(view.id);d.selectDimension(id);await H.wait(150);
 const onView=document.querySelector('[data-field="dimOnView"]');check(!!onView,'the panel offers the line on the view');check(onView.checked,'the panel shows the line is on the view');
 onView.click();await H.wait(200);
 check(dimension().insideAt===undefined,'the panel takes the line off the view');
 check(dimension().offset===initial.offset,'the distance outside the view is kept, so the line comes back where it was');
 check(!document.querySelector('[data-field="dimOnViewAt"]'),'the panel asks for the distance outside while the line is off');
 document.querySelector('[data-field="dimOnView"]').click();await H.wait(200);
 check(dimension().insideAt!==undefined,'the panel puts the line on the view');
 check(Number.isFinite(dimension().insideAt),'the place on the view is a number');
 const at=document.querySelector('[data-field="dimOnViewAt"]');check(!!at,'the panel shows where the line is on the view');
 return {pass:true,value};
}};
