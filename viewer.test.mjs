import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const store=createRequire(import.meta.url)('./app/folder-store.js');
test('回归：已有在线原图地址时开启保存大图仍会保存',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{showModal(){this.open=true;}});return nodes.get(id);},folder={};
 const work={id:'1',largeUrl:'https://cdn.donmai.us/original/a.jpg'};let data={saveLargeImages:true,artists:[{uid:'0001-a-1',works:[work]}]},writes=0;
 const ctx={document:{getElementById:node},structuredClone,FolderStore:{imageOf:store.imageOf,saveImage:async()=>{writes++;return '大图/a.jpeg';}},ArtistImages:{dispose(){},bind(){},fetch:async()=>new Blob(['image'])},ArtistExtension:{connected:false}};
 vm.runInNewContext(await fs.readFile('app/viewer.js','utf8'),ctx);
 ctx.ArtistViewer.init({getFolder:()=>folder,getData:()=>data,save:async next=>{data=typeof next==='function'?next(structuredClone(data)):next;return true;},notify(){}});
 ctx.ArtistViewer.open({title:'a',uid:'0001-a-1',work,persist:true});for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));
 assert.equal(writes,1);assert.equal(data.artists[0].works[0].large,'大图/a.jpeg');
});


test('回归：原图下载期间换文件夹时，不把旧预览写进新库',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{showModal(){this.open=true;}});return nodes.get(id);};
 let folder={},writes=0,release;const response=new Promise(r=>release=r),work={id:'1',largeUrl:'https://cdn.donmai.us/original/a.jpg'};
 const ctx={document:{getElementById:node},structuredClone,FolderStore:{imageOf:store.imageOf,saveImage:async()=>{writes++;return '大图/a.jpeg';}},ArtistImages:{dispose(){},bind(){},fetch:()=>response},ArtistExtension:{connected:false}};
 vm.runInNewContext(await fs.readFile('app/viewer.js','utf8'),ctx);
 ctx.ArtistViewer.init({getFolder:()=>folder,getData:()=>({saveLargeImages:true}),save:async()=>{},notify(){}});
 ctx.ArtistViewer.open({title:'a',uid:'0001-a-1',work,persist:true});folder={};release(new Blob(['image']));for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));
 assert.equal(writes,0);
});

test('同一画师图片可以前后切换，序号正确且循环返回',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{showModal(){this.open=true;}});return nodes.get(id);};
 const works=[{id:'1',large:'大图/a.jpeg'},{id:'2',large:'大图/b.jpeg'},{id:'3',large:'大图/c.jpeg'}],bound=[];
 const ctx={document:{getElementById:node},FolderStore:{imageOf:store.imageOf},ArtistImages:{dispose(){},bind(img,uid,work,group,size){bound.push({id:work.id,size});},fetch:async()=>new Blob(['image'])},ArtistExtension:{connected:false}};
 vm.runInNewContext(await fs.readFile('app/viewer.js','utf8'),ctx);ctx.ArtistViewer.init({getFolder:()=>({}),getData:()=>({saveLargeImages:false}),save:async()=>{},notify(){}});
 ctx.ArtistViewer.open({title:'画师',uid:'a',work:works[0],items:works,persist:true});assert.equal(node('viewer-position').textContent,'1 / 3');assert.equal(node('viewer-navigation').hidden,false);
 ctx.ArtistViewer.step(-1);assert.equal(node('viewer-position').textContent,'3 / 3');ctx.ArtistViewer.step(1);assert.equal(node('viewer-position').textContent,'1 / 3');ctx.ArtistViewer.step(1);assert.equal(node('viewer-position').textContent,'2 / 3');
 for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));assert.equal(bound.at(-1).id,'2','旧图片的异步结果不能覆盖当前图片');
 node('large-image').onload();assert.match(node('viewer-caption').textContent,/本地原图/,'已有本地图片不能说成临时图片');
});
test('单图或候选图不显示上一张下一张导航',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{showModal(){this.open=true;}});return nodes.get(id);};
 const ctx={document:{getElementById:node},FolderStore:{imageOf:()=>({kind:'inline'})},ArtistImages:{dispose(){},bind(){},fetch:async()=>new Blob()},ArtistExtension:{connected:false}};
 vm.runInNewContext(await fs.readFile('app/viewer.js','utf8'),ctx);ctx.ArtistViewer.init({getFolder:()=>null,getData:()=>({}),save(){},notify(){}});
 const work={id:'1'};ctx.ArtistViewer.open({title:'候选',uid:'a',work});assert.equal(node('viewer-navigation').hidden,true);ctx.ArtistViewer.step(1);assert.equal(node('viewer-position').textContent,'');
 ctx.ArtistViewer.open({title:'单图',uid:'a',work,items:[work]});assert.equal(node('viewer-navigation').hidden,true);assert.equal(node('viewer-position').textContent,'1 / 1');
});


test('退场延迟释放原图，旧关闭回调不清空快速重开的新预览',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{showModal(){this.open=true;}});return nodes.get(id);};
 let disposed=0,finishOld,finishNew;
 const oldExit=new Promise(resolve=>finishOld=resolve),newExit=new Promise(resolve=>finishNew=resolve),work={id:'1'};
 const ctx={document:{getElementById:node},FolderStore:{imageOf:()=>({kind:'inline'})},ArtistImages:{dispose(){disposed++;},bind(){},fetch:async()=>new Blob()},ArtistExtension:{connected:false}};
 vm.runInNewContext(await fs.readFile('app/viewer.js','utf8'),ctx);ctx.ArtistViewer.init({getFolder:()=>null,getData:()=>({}),save(){},notify(){}});
 const open=()=>ctx.ArtistViewer.open({title:'图片',uid:'a',work});
 open();node('viewer').open=false;node('viewer').getAnimations=()=>[{finished:oldExit}];ctx.ArtistViewer.dispose();
 assert.equal(disposed,0,'加载器接管旧绑定，退场中保留当前图');
 open();ctx.ArtistViewer.dispose(); // 已重新打开时到达的旧 close 事件须忽略。
 node('viewer').open=false;node('viewer').getAnimations=()=>[{finished:newExit}];ctx.ArtistViewer.dispose();
 finishOld();await new Promise(resolve=>setImmediate(resolve));assert.equal(disposed,0,'旧退场结束不能清理新预览');
 finishNew();await new Promise(resolve=>setImmediate(resolve));assert.equal(disposed,1,'当前退场完成后释放图片');
});
