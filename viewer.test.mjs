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
