import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),store=require('./app/folder-store.js');
class Directory{
 constructor(name='数据'){this.name=name;this.kind='directory';this.items=new Map();}
 async getDirectoryHandle(name,{create=false}={}){if(!this.items.has(name)&&create)this.items.set(name,new Directory(name));const item=this.items.get(name);if(!item)throw new DOMException('不存在','NotFoundError');return item;}
 async getFileHandle(name,{create=false}={}){if(!this.items.has(name)&&create)this.items.set(name,{name,kind:'file',bytes:''});const item=this.items.get(name);if(!item)throw new DOMException('不存在','NotFoundError');return {getFile:async()=>new Blob([item.bytes]),createWritable:async()=>({write:async value=>{item.bytes=value;},close:async()=>{},abort:async()=>{}})};}
 async *values(){yield* this.items.values();}
 async removeEntry(name){this.items.delete(name);}
}
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
test('文件夹保存、图片往返、改名、数量及清理',async()=>{
 const dir=new Directory();assert.equal((await store.read(dir)).artists.length,0);
 const library={version:1,tags:['自定义'],artists:[{uid:'danbooru-123',name:'artist',counts:{total:20},works:[{id:'1',image:png}]}]};
 await store.write(dir,library);let restored=await store.read(dir);assert.equal(restored.artists[0].works[0].image,undefined);const blob=await store.readImage(dir,restored.artists[0].uid,restored.artists[0].works[0].file);assert.equal('data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64'),png);assert.equal(restored.artists[0].counts.total,20);assert.deepEqual(restored.tags,['自定义']);
 restored.artists[0].name='renamed';await store.write(dir,restored);assert.equal((await store.read(dir)).artists[0].name,'renamed');
 restored.artists[0].works=[];await store.write(dir,restored);assert.equal(dir.items.get('画师').items.get('danbooru-123').items.get('预览图').items.size,0);
 await store.write(dir,store.empty());assert.equal(dir.items.get('画师').items.size,0);
});
test('拒绝错误文件夹和越界标识，不改原内容',async()=>{
 const dir=new Directory();await dir.getFileHandle('用户文件.txt',{create:true});await assert.rejects(store.read(dir),/请选择/);
 await assert.rejects(store.write(dir,{version:1,artists:[{uid:'../wrong',works:[]}]}),/标识/);assert.equal(dir.items.size,1);
});
test('刷新只查询当前画师的两项数量，不请求预览图',async()=>{
 const {details}=require('./app/artist-lookup.js');const requests=[];
 const result=await details('artist_a','2026-08-01',{previews:false,fetcher:async value=>{const u=new URL(value);requests.push(u);return {ok:true,json:async()=>({counts:{posts:u.searchParams.get('tags').includes('date:')?12:20}})};}});
 assert.equal(requests.length,2);assert.ok(requests.every(u=>u.pathname==='/counts/posts.json'));assert.deepEqual(requests.map(u=>u.searchParams.get('tags')),['artist_a','artist_a date:<2026-08-01']);assert.equal(result.counts.total,20);assert.equal(result.counts.beforeTotal,12);
});
test('修改全局截至日期会保存设置但不会改写既有数量',async()=>{
 const dir=new Directory();const library={version:1,cutoffDate:'2026-07-01',tags:[],artists:[{uid:'test',name:'artist',counts:{total:20,beforeTotal:12,beforeDate:'2026-07-01'},works:[]}]};
 await store.write(dir,library);library.cutoffDate='2026-08-01';await store.write(dir,library);const restored=await store.read(dir);assert.equal(restored.cutoffDate,'2026-08-01');assert.deepEqual(restored.artists[0].counts,{total:20,beforeTotal:12,beforeDate:'2026-07-01'});
});
test('流式导出包含实际图片，并可恢复',async()=>{
 const dir=new Directory();await store.write(dir,{version:1,tags:[],artists:[{uid:'sample',name:'artist',works:[{id:'1',image:png}]}]});const data=await store.read(dir),chunks=[];await store.exportTo(dir,data,{write:async s=>chunks.push(s)});const backup=JSON.parse(chunks.join(''));assert.equal(backup.artists[0].works[0].image,png);assert.ok(chunks.length>3);
 const restoredDir=new Directory();await store.write(restoredDir,backup);const restored=await store.read(restoredDir);assert.ok(restored.artists[0].works[0].file);
});
test('清理失败会记录为警告，不再静默忽略',async()=>{
 const dir=new Directory();await store.write(dir,{version:1,tags:[],artists:[{uid:'keep',name:'artist',works:[]}]});store.takeWarnings();
 const artists=dir.items.get('画师'),original=artists.removeEntry.bind(artists);artists.removeEntry=async name=>{throw new DOMException('被占用','InvalidModificationError');};
 await store.write(dir,{version:1,tags:[],artists:[]});const warnings=store.takeWarnings();
 artists.removeEntry=original;
 assert.equal(warnings.length,1);assert.match(warnings[0],/keep/);assert.deepEqual(store.takeWarnings(),[]);
});
test('2000 位画师、10000 张图片：启动零图片读取，单次修改仅写一个资料文件',async()=>{
 const dir=new Directory(),artists=await dir.getDirectoryHandle('画师',{create:true});let imageReads=0,infoWrites=0;
 for(let i=0;i<2000;i++){const id='artist-'+i,a=await artists.getDirectoryHandle(id,{create:true});a.items.set('信息.json',{name:'信息.json',kind:'file',bytes:JSON.stringify({uid:id,name:id,works:Array.from({length:5},(_,n)=>({id:String(n),file:'预览图/'+String(n).padStart(24,'0')+'.png'}))})});const original=a.getFileHandle.bind(a);a.getFileHandle=async(name,options)=>{const handle=await original(name,options);const create=handle.createWritable;handle.createWritable=async()=>{infoWrites++;return create();};return handle;};a.getDirectoryHandle=async()=>{imageReads++;throw Error('启动时不能打开图片目录');};}
 dir.items.set('画师库.json',{name:'画师库.json',kind:'file',bytes:JSON.stringify({version:1,tags:[],artists:Array.from({length:2000},(_,i)=>'artist-'+i)})});
 const start=performance.now(),data=await store.read(dir);assert.equal(data.artists.length,2000);assert.equal(imageReads,0);assert.equal(data.artists.reduce((n,a)=>n+a.works.length,0),10000);
 // Only the changed record is allowed to open its image directory during save.
 const changed=artists.items.get('artist-1000');changed.getDirectoryHandle=Directory.prototype.getDirectoryHandle.bind(changed);data.artists[1000].name='changed';await store.write(dir,data);assert.equal(infoWrites,1);assert.equal(imageReads,0);console.log('2000 人元数据读取与单条保存模拟耗时：'+Math.round(performance.now()-start)+' ms');
});
