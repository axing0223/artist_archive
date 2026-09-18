import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),store=require('./app/folder-store.js');
class FileHandle{
 constructor(name,bytes=''){this.name=name;this.kind='file';this.bytes=bytes;}
 async getFile(){return new Blob([this.bytes]);}
 async createWritable(){const self=this;return {write:async value=>{self.bytes=value;},close:async()=>{},abort:async()=>{}};}
}
class Directory{
 constructor(name='数据'){this.name=name;this.kind='directory';this.items=new Map();}
 async getDirectoryHandle(name,{create=false}={}){if(!this.items.has(name)&&create)this.items.set(name,new Directory(name));const item=this.items.get(name);if(!item||item.kind!=='directory')throw new DOMException('不存在','NotFoundError');return item;}
 async getFileHandle(name,{create=false}={}){if(!this.items.has(name)&&create)this.items.set(name,new FileHandle(name));const item=this.items.get(name);if(!item||item.kind!=='file')throw new DOMException('不存在','NotFoundError');return item;}
 async *values(){yield* this.items.values();}
 async removeEntry(name){this.items.delete(name);}
}
const put=async(dir,name,bytes)=>{const handle=await dir.getFileHandle(name,{create:true}),writable=await handle.createWritable();await writable.write(bytes);await writable.close();};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const jpeg='data:image/jpeg;base64,/9j/2Q==';
const bytesOf=async blob=>new Uint8Array(await blob.arrayBuffer());
test('缩略图与原图分别落进 缩略图/ 大图/，imageOf 本地优先于在线',async()=>{
 const dir=new Directory();await store.write(dir,store.empty());
 const thumb=await store.saveImage(dir,'0001-a-1','thumb',new Blob([Uint8Array.from([1,2,3])],{type:'image/jpeg'}));
 const large=await store.saveImage(dir,'0001-a-1','large',new Blob([Uint8Array.from([4,5,6,7])],{type:'image/jpeg'}));
 assert.match(thumb,/^缩略图\/[a-f0-9]{24}\.jpeg$/);
 assert.match(large,/^大图\/[a-f0-9]{24}\.jpeg$/);
 assert.deepEqual(store.imageOf({thumb,thumbUrl:'https://cdn.donmai.us/a.jpg'},'thumb'),{kind:'local',path:thumb});
 assert.deepEqual(store.imageOf({thumbUrl:'https://cdn.donmai.us/a.jpg'},'thumb'),{kind:'remote',url:'https://cdn.donmai.us/a.jpg'});
 assert.deepEqual(store.imageOf({previewUrl:'https://cdn.donmai.us/720x720/a.jpg'},'preview'),{kind:'remote',url:'https://cdn.donmai.us/720x720/a.jpg'});
 assert.deepEqual(store.imageOf({largeUrl:'https://cdn.donmai.us/original/a.jpg'},'preview'),{kind:'remote',url:'https://cdn.donmai.us/original/a.jpg'},'没有中图时放大回退到原图');
 assert.equal(store.imageOf({thumbUrl:'https://cdn.donmai.us/180x180/a.jpg'},'preview'),null,'不会把缩略图当成放大图');
 assert.equal(store.imageOf({},'large'),null);
 assert.deepEqual(await bytesOf(await store.readImage(dir,'0001-a-1',large)),Uint8Array.from([4,5,6,7]));
 await assert.rejects(()=>store.saveImage(dir,'0001-a-1','large',new Blob([],{type:'image/jpeg'})),/空/);
 await assert.rejects(()=>store.saveImage(dir,'0001-a-1','large',new Blob([Uint8Array.from([1])],{type:'image/tiff'})),/不支持/);
 await assert.rejects(()=>store.saveImage(dir,'../evil','thumb',new Blob([Uint8Array.from([1])],{type:'image/jpeg'})),/标识/);
});
test('保存、图片往返、改名、数量及清理',async()=>{
 const dir=new Directory();assert.equal((await store.read(dir)).artists.length,0);
 const library={version:1,tags:['自定义'],artists:[{uid:'0001-artist-123',name:'artist',counts:{total:20},works:[{id:'1',thumb:png}]}]};
 await store.write(dir,library);let restored=await store.read(dir);
 assert.equal(restored.artists[0].works[0].thumb.startsWith('缩略图/'),true);
 assert.equal(restored.artists[0].works[0].image,undefined,'旧字段已清除');
 const blob=await store.readImage(dir,restored.artists[0].uid,restored.artists[0].works[0].thumb);
 assert.equal('data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64'),png);
 assert.equal(restored.artists[0].counts.total,20);assert.deepEqual(restored.tags,['自定义']);
 restored.artists[0].name='renamed';await store.write(dir,restored);assert.equal((await store.read(dir)).artists[0].name,'renamed');
 restored.artists[0].works=[];await store.write(dir,restored);
 assert.equal(dir.items.get('画师').items.get('0001-artist-123').items.get('缩略图').items.size,0);
 await store.write(dir,store.empty());assert.equal(dir.items.get('画师').items.size,0);
});
test('旧版数据自动升级为 序号-名字-编号，并把预览图搬进 缩略图',async()=>{
 const dir=new Directory(),artists=new Directory('画师'),folder=new Directory('danbooru-196870'),previews=new Directory('预览图');
 const name='0'.repeat(24)+'.jpeg';
 dir.items.set('画师',artists);artists.items.set('danbooru-196870',folder);folder.items.set('预览图',previews);
 previews.items.set(name,new FileHandle(name,Uint8Array.from([7,7,7])));
 folder.items.set('信息.json',new FileHandle('信息.json',JSON.stringify({uid:'danbooru-196870',name:'iuui',danbooruId:196870,works:[{id:'1',file:'预览图/'+name,image:'https://cdn.donmai.us/a.jpg'}]})));
 dir.items.set('画师库.json',new FileHandle('画师库.json',JSON.stringify({version:1,tags:[],artists:['danbooru-196870']})));
 const data=await store.read(dir);
 assert.equal(data.artists[0].uid,'0001-iuui-196870','旧标识补上序号');
 assert.equal(data.artists[0].works[0].thumb,'缩略图/'+name);
 assert.equal(data.artists[0].works[0].thumbUrl,'https://cdn.donmai.us/a.jpg','在线缩略图另存为 thumbUrl');
 assert.deepEqual(await bytesOf(await store.readImage(dir,'0001-iuui-196870','缩略图/'+name)),Uint8Array.from([7,7,7]),'迁移落盘前仍能按新标识读到旧目录里的图');
 await store.write(dir,data);
 assert.equal(artists.items.has('danbooru-196870'),false,'旧目录已删除');
 const moved=artists.items.get('0001-iuui-196870');
 assert.equal(moved.items.get('缩略图').items.get(name).bytes.length,3,'图片已搬到新目录');
 assert.equal(JSON.parse(moved.items.get('信息.json').bytes).uid,'0001-iuui-196870');
 assert.deepEqual(JSON.parse(dir.items.get('画师库.json').bytes).artists,['0001-iuui-196870']);
});
test('序号已占用的旧画师不会撞号，发号从最大序号往后走',async()=>{
 const dir=new Directory(),artists=new Directory('画师');
 dir.items.set('画师',artists);
 const add=(uid,body)=>{const folder=new Directory(uid);artists.items.set(uid,folder);folder.items.set('信息.json',new FileHandle('信息.json',JSON.stringify({uid,name:body.name,danbooruId:body.danbooruId??null,works:[]})));};
 add('0005-fifth-5',{name:'fifth',danbooruId:5});add('old-one',{name:'oldone',danbooruId:9});add('old-two',{name:'oldtwo'});
 dir.items.set('画师库.json',new FileHandle('画师库.json',JSON.stringify({version:1,tags:[],artists:['0005-fifth-5','old-one','old-two']})));
 const data=await store.read(dir);
 assert.deepEqual(data.artists.map(a=>a.uid),['0005-fifth-5','0001-oldone-9','0002-oldtwo-manual']);
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
test('识别区按页取作品，每张都带缩略图与原图地址，无效条目被丢弃',async()=>{
 const {posts}=require('./app/artist-lookup.js');const requests=[];
 const rows=[
  {id:3,preview_file_url:'https://cdn.donmai.us/180x180/a.jpg',file_url:'https://cdn.donmai.us/original/a.jpg',media_asset:{variants:[{type:'720x720',url:'https://cdn.donmai.us/720x720/a.jpg'}]}},
  {id:2,media_asset:{variants:[{type:'360x360',url:'https://cdn.donmai.us/360x360/b.jpg'},{type:'original',url:'https://cdn.donmai.us/original/b.jpg'}]}},
  {id:1,large_file_url:'https://cdn.donmai.us/sample/c.jpg'},
  {id:0},null
 ];
 const works=await posts('artist_a',{limit:20,page:2,fetcher:async value=>{requests.push(new URL(value));return {ok:true,json:async()=>rows};}});
 assert.equal(requests.length,1);assert.equal(requests[0].pathname,'/posts.json');
 assert.equal(requests[0].searchParams.get('tags'),'artist_a order:id_desc');
 assert.equal(requests[0].searchParams.get('limit'),'20');assert.equal(requests[0].searchParams.get('page'),'2');
 assert.equal(works.length,3,'编号非法的条目被丢弃');
 assert.deepEqual(works[0],{id:'3',url:'https://danbooru.donmai.us/posts/3',caption:'',thumbUrl:'https://cdn.donmai.us/360x360/a.jpg',previewUrl:'https://cdn.donmai.us/720x720/a.jpg',largeUrl:'https://cdn.donmai.us/original/a.jpg'},'只有 180 缩略图时自动换成 360 尺寸');
 assert.deepEqual(works[1],{id:'2',url:'https://danbooru.donmai.us/posts/2',caption:'',thumbUrl:'https://cdn.donmai.us/360x360/b.jpg',previewUrl:'https://cdn.donmai.us/360x360/b.jpg',largeUrl:'https://cdn.donmai.us/original/b.jpg'},'接口直接给出 360 时用它');
 assert.equal(works[2].largeUrl,'https://cdn.donmai.us/sample/c.jpg','没有原图地址时回退到 large_file_url');
 assert.equal(works[2].thumbUrl,null);
 await assert.rejects(posts('a',{fetcher:async()=>({ok:false,status:429})}),/频繁/);
 await assert.rejects(posts('a',{fetcher:async()=>({ok:true,json:async()=>({})})}),/未返回作品/);
});
test('测试风格图片排在作品之后，且不会被作品挤出卡片预览',()=>{
 const works=[1,2,3,4,5,6].map(n=>({id:String(n)}));
 const artist={works:[...works,{id:'',kind:'test'}]};
 const shown=store.previewWorks(artist);
 assert.equal(shown.length,5);
 assert.equal(shown[4].kind,'test','测试风格图片固定在最后一位');
 assert.deepEqual(shown.slice(0,4).map(w=>w.id),['1','2','3','4'],'为了让出位置，作品少显示一张');
 assert.deepEqual(store.previewWorks({works}).map(w=>w.id),['1','2','3','4','5'],'没有测试图时照旧显示前 5 张作品');
 const many={works:[...works,{id:'',kind:'test'},{id:'',kind:'test'},{id:'',kind:'test'},{id:'',kind:'test'},{id:'',kind:'test'},{id:'',kind:'test'}]};
 assert.equal(store.previewWorks(many).filter(w=>w.kind==='test').length,5,'测试图最多占满 5 个位置');
 assert.equal(store.previewWorks(many)[0].kind,'test','作品让位后全部是测试图');
 assert.deepEqual(store.previewWorks({works:[]}),[]);
});
test('测试风格图片的标记随数据保存、导出与恢复',async()=>{
 const dir=new Directory();
 await store.write(dir,{version:1,tags:[],artists:[{uid:'0001-a',name:'a',works:[{id:'1',thumb:png},{id:'',thumb:png,kind:'test'}]}]});
 const restored=await store.read(dir);
 assert.equal(restored.artists[0].works.length,2);
 assert.equal(restored.artists[0].works[1].kind,'test','标记不能在保存后丢失');
 const chunks=[];await store.exportTo(dir,restored,{write:async s=>chunks.push(s)});
 assert.equal(JSON.parse(chunks.join('')).artists[0].works[1].kind,'test','导出备份也要带上标记');
});
test('主分类列表随数据保存与读取，画师可引用自定义分类',async()=>{
 const dir=new Directory();
 await store.write(dir,{version:1,categories:['厚涂向','像素风'],tags:[],artists:[{uid:'0001-a',name:'a',category:'像素风',works:[]}]});
 const restored=await store.read(dir);
 assert.deepEqual(restored.categories,['厚涂向','像素风']);
 assert.equal(restored.artists[0].category,'像素风');
});
test('修改全局截至日期会保存设置但不会改写既有数量',async()=>{
 const dir=new Directory();const library={version:1,cutoffDate:'2026-07-01',tags:[],artists:[{uid:'0001-test',name:'artist',counts:{total:20,beforeTotal:12,beforeDate:'2026-07-01'},works:[]}]};
 await store.write(dir,library);library.cutoffDate='2026-08-01';await store.write(dir,library);const restored=await store.read(dir);assert.equal(restored.cutoffDate,'2026-08-01');assert.deepEqual(restored.artists[0].counts,{total:20,beforeTotal:12,beforeDate:'2026-07-01'});
});
test('流式导出含本地缩略图与原图，并可恢复',async()=>{
 const dir=new Directory();
 await store.write(dir,{version:1,tags:[],artists:[{uid:'0001-sample',name:'artist',works:[{id:'1',thumb:png,large:jpeg,thumbUrl:'https://cdn.donmai.us/a.jpg'}]}]});
 const data=await store.read(dir),chunks=[];await store.exportTo(dir,data,{write:async s=>chunks.push(s)});const backup=JSON.parse(chunks.join(''));
 assert.equal(backup.artists[0].works[0].thumb,png,'本地缩略图被还原成 data:');
 assert.equal(backup.artists[0].works[0].large,jpeg,'本地原图被还原成 data:');
 assert.equal(backup.artists[0].works[0].thumbUrl,'https://cdn.donmai.us/a.jpg','在线地址原样保留');
 const restoredDir=new Directory();await store.write(restoredDir,backup);const restored=await store.read(restoredDir);
 assert.match(restored.artists[0].works[0].thumb,/^缩略图\//);assert.match(restored.artists[0].works[0].large,/^大图\//);
});
test('清理失败会记录为警告，不再静默忽略',async()=>{
 const dir=new Directory();await store.write(dir,{version:1,tags:[],artists:[{uid:'0001-keep',name:'artist',works:[]}]});store.takeWarnings();
 const artists=dir.items.get('画师'),original=artists.removeEntry.bind(artists);artists.removeEntry=async name=>{throw new DOMException('被占用','InvalidModificationError');};
 await store.write(dir,{version:1,tags:[],artists:[]});const warnings=store.takeWarnings();
 artists.removeEntry=original;
 assert.equal(warnings.length,1);assert.match(warnings[0],/0001-keep/);assert.deepEqual(store.takeWarnings(),[]);
});
test('2000 位画师、10000 张图片：启动零图片读取，单次修改仅写一个资料文件',async()=>{
 const dir=new Directory(),artists=await dir.getDirectoryHandle('画师',{create:true});let imageReads=0;
 for(let i=0;i<2000;i++){const id=String(i+1).padStart(4,'0')+'-artist-'+i+'-manual',a=await artists.getDirectoryHandle(id,{create:true});a.items.set('信息.json',new FileHandle('信息.json',JSON.stringify({uid:id,name:'artist-'+i,works:Array.from({length:5},(_,n)=>({id:String(n),thumb:'缩略图/'+String(n).padStart(24,'0')+'.png'}))})));
  a.getDirectoryHandle=async()=>{imageReads++;throw Error('启动时不能打开图片目录');};}
 dir.items.set('画师库.json',new FileHandle('画师库.json',JSON.stringify({version:1,tags:[],artists:Array.from({length:2000},(_,i)=>String(i+1).padStart(4,'0')+'-artist-'+i+'-manual')})));
 const start=performance.now(),data=await store.read(dir);assert.equal(data.artists.length,2000);assert.equal(imageReads,0);assert.equal(data.artists.reduce((n,a)=>n+a.works.length,0),10000);
 const snapshot=new Map();for(const [id,folder] of artists.items)snapshot.set(id,JSON.stringify(folder.items.get('信息.json').bytes));
 const changed=artists.items.get('1001-artist-1000-manual');changed.getDirectoryHandle=Directory.prototype.getDirectoryHandle.bind(changed);data.artists[1000].name='changed';
 await store.write(dir,data);assert.equal(imageReads,0);
 const rewritten=[...artists.items].filter(([id,folder])=>snapshot.get(id)!==JSON.stringify(folder.items.get('信息.json').bytes)).map(([id])=>id);
 assert.deepEqual(rewritten,['1001-artist-1000-manual'],'只有改动的那一位资料被重写');
 console.log('2000 人元数据读取与单条保存模拟耗时：'+Math.round(performance.now()-start)+' ms');
});
