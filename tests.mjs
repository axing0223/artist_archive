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
 async removeEntry(name){if(!this.items.has(name))throw new DOMException('找不到','NotFoundError');this.items.delete(name);}
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
test('测试风格图按「画师tag-测试风格N」落盘，缩略图与大图各自带扩展名',async()=>{
 const dir=new Directory();await store.write(dir,store.empty());
 const data=store.empty();
 data.artists.push({uid:'0001-modare-105704',order:1,name:'modare',category:null,score:null,aliases:[],alias:null,tags:[],danbooruId:105704,counts:{},artistUrl:'',description:'',note:'',basis:'',status:'',
  works:[{id:'',url:'',caption:'',kind:'test',testSeq:1,thumb:jpeg,large:png,thumbUrl:null,largeUrl:null},{id:'7',url:'https://danbooru.donmai.us/posts/7',caption:'',thumb:jpeg,large:null,thumbUrl:null,largeUrl:null}]});
 const saved=await store.write(dir,data);
 const [generated,work]=saved.artists[0].works;
 assert.equal(generated.large,'大图/modare-测试风格1.png','原图用画师 tag 与测试风格序号命名');
 assert.equal(generated.thumb,'缩略图/modare-测试风格1.jpeg','缩略图同名、换自己的扩展名，不把 JPG 写成 .png');
 assert.match(work.thumb,/^缩略图\/[a-f0-9]{24}\.jpeg$/,'普通作品图照旧按内容哈希命名');
 assert.deepEqual(await bytesOf(await store.readImage(dir,'0001-modare-105704',generated.large)),Uint8Array.from(Buffer.from(png.split(',')[1],'base64')),'大图读回来还是原来那张 PNG');
 assert.equal(store.validWork(generated),true,'新名字要能通过数据校验');
});
test('画师名里的非法字符会被换掉，过长的名字截断，非法序号按 1 处理',()=>{
 assert.equal(store.testImageName('modare',1),'modare-测试风格1');
 assert.equal(store.testImageName('a/b:c*?"<>|d',2),'a_b_c______d-测试风格2','八个非法字符各换成一个下划线');
 assert.equal(store.testImageName('   ',3),'画师-测试风格3','名字全是空白时给一个能用的兜底');
 assert.equal(store.testImageName('x'.repeat(200),1),'x'.repeat(80)+'-测试风格1','过长的画师名要截断');
 assert.equal(store.testImageName('a',0),'a-测试风格1','非法序号按 1 处理');
});
test('清理只删自己写出来的图片名，用户放进目录里的其它文件不动',async()=>{
 const dir=new Directory();await store.write(dir,store.empty());
 const data=store.empty();
 data.artists.push({uid:'0001-a-1',order:1,name:'a',category:null,score:null,aliases:[],alias:null,tags:[],danbooruId:null,counts:{},artistUrl:'',description:'',note:'',basis:'',status:'',
  works:[{id:'',url:'',caption:'',kind:'test',testSeq:1,thumb:jpeg,large:png,thumbUrl:null,largeUrl:null}]});
 const first=await store.write(dir,data);
 const folder=await (await dir.getDirectoryHandle('画师')).getDirectoryHandle('0001-a-1');
 const large=await folder.getDirectoryHandle('大图');
 await put(large,'a-测试风格9.png',Uint8Array.from([1,2,3]));
 await put(large,'我的笔记.png',Uint8Array.from([9,9,9]));
 await put(large,'aa-测试风格1.png',Uint8Array.from([8,8,8]));
 data.artists[0].works[0].caption='改一下，让这次真的写盘';
 const second=await store.write(dir,data);
 assert.equal(second.artists[0].works[0].large,first.artists[0].works[0].large,'重写后仍然指向同一张图');
 assert.deepEqual([...large.items.keys()].sort(),['a-测试风格1.png','我的笔记.png'],'过期的测试图被清掉，用户自己的文件留下');
});
test('同一批里出现重名时往后加序号，不互相覆盖',async()=>{
 const dir=new Directory();await store.write(dir,store.empty());
 const data=store.empty();
 const work=seq=>({id:'',url:'',caption:'',kind:'test',testSeq:seq,thumb:jpeg,large:png,thumbUrl:null,largeUrl:null});
 data.artists.push({uid:'0001-a-1',order:1,name:'a',category:null,score:null,aliases:[],alias:null,tags:[],danbooruId:null,counts:{},artistUrl:'',description:'',note:'',basis:'',status:'',works:[work(1),work(1)]});
 const saved=await store.write(dir,data);
 assert.deepEqual(saved.artists[0].works.map(w=>w.large),['大图/a-测试风格1.png','大图/a-测试风格1-2.png']);
});
test('索引里有、盘上没有的画师目录只跳过并记警告，不让整个库打不开',async()=>{
 const dir=new Directory(),artists=new Directory('画师');
 dir.items.set('画师',artists);
 for(const uid of ['0001-a-1','0002-b-2','0003-c-3']){
  const folder=new Directory(uid);folder.items.set('信息.json',new FileHandle('信息.json',JSON.stringify({uid,name:uid,works:[]})));artists.items.set(uid,folder);
 }
 artists.items.delete('0002-b-2');
 dir.items.set('画师库.json',new FileHandle('画师库.json',JSON.stringify({version:1,tags:[],artists:['0001-a-1','0002-b-2','0003-c-3']})));
 store.takeWarnings();
 const data=await store.read(dir);
 assert.deepEqual(data.artists.map(a=>a.uid),['0001-a-1','0003-c-3'],'缺的那位跳过，其余照常读出');
 assert.deepEqual(data.artists.map(a=>a.order),[1,2],'跳过后序号要重新排连续');
 const warnings=store.takeWarnings();
 assert.equal(warnings.length,1);assert.match(warnings[0],/0002-b-2/,'要如实报出缺了谁');
});
test('批量改标识时旧目录只删一次，不产生「找不到」的假警告',async()=>{
 const dir=new Directory();
 await store.write(dir,store.empty());store.takeWarnings();
 const created=await store.read(dir);
 created.artists=['0001-a-manual','0002-b-manual','0003-c-manual'].map((uid,i)=>({uid,name:'n'+i,works:[]}));
 await store.write(dir,created);
 const next=await store.read(dir);
 next.artists.forEach((a,i)=>{const to=a.uid.replace('-manual','-'+(i+1));store.rename(dir,a.uid,to);a.uid=to;});
 await store.write(dir,next);
 assert.deepEqual(store.takeWarnings(),[],'旧目录只该删一次；第二段再删会报「找不到」，那不是失败');
 const artists=await dir.getDirectoryHandle('画师');
 assert.deepEqual([...artists.items.keys()],['0001-a-1','0002-b-2','0003-c-3'],'只剩新目录');
});
test('uid 变更时把旧目录的缩略图与大图搬到新目录，再删掉旧目录',async()=>{
 const dir=new Directory();
 await store.write(dir,store.empty());
 const thumb=await store.saveImage(dir,'0001-old-1','thumb',new Blob([Uint8Array.from([1,2,3])],{type:'image/jpeg'}));
 const large=await store.saveImage(dir,'0001-old-1','large',new Blob([Uint8Array.from([4,5,6,7])],{type:'image/jpeg'}));
 const first=await store.read(dir);
 first.artists=[{uid:'0001-old-1',name:'old',works:[{id:'1',thumb,large}]}];
 await store.write(dir,first);
 const artists=await dir.getDirectoryHandle('画师');
 assert.equal(artists.items.has('0001-old-1'),true,'先有一位旧名字的画师');

 const next=await store.read(dir);
 store.rename(dir,'0001-old-1','0001-new-2');
 next.artists[0].uid='0001-new-2';next.artists[0].name='new';
 await store.write(dir,next);

 assert.equal(artists.items.has('0001-new-2'),true,'新目录要建出来');
 assert.equal(artists.items.has('0001-old-1'),false,'旧目录要清掉');
 assert.deepEqual(await bytesOf(await store.readImage(dir,'0001-new-2',thumb)),Uint8Array.from([1,2,3]),'缩略图必须跟着搬，否则改名就把图弄丢了');
 assert.deepEqual(await bytesOf(await store.readImage(dir,'0001-new-2',large)),Uint8Array.from([4,5,6,7]),'大图也要搬');
 assert.deepEqual(store.takeWarnings(),[],'迁移不该产生警告');
});
test('没登记 uid 变更时，新目录里不会有旧图片',async()=>{
 const dir=new Directory();
 await store.write(dir,store.empty());
 const thumb=await store.saveImage(dir,'0002-old-1','thumb',new Blob([Uint8Array.from([9])],{type:'image/jpeg'}));
 const first=await store.read(dir);
 first.artists=[{uid:'0002-old-1',name:'old',works:[{id:'1',thumb}]}];
 await store.write(dir,first);
 const next=await store.read(dir);
 next.artists[0].uid='0002-new-2';
 await store.write(dir,next);
 await assert.rejects(()=>store.readImage(dir,'0002-new-2',thumb),/不存在/,'不登记就等于承认图片会丢——所以改 uid 前必须先 rename()');
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
test('画师候选带回全部笔名，不再只取前五个',async()=>{
 const {candidates}=require('./app/artist-lookup.js');
 const names=Array.from({length:12},(_,i)=>'别名'+i);
 const rows=candidates([{id:9,name:'artist_a',other_names:names,is_deleted:false}]);
 assert.equal(rows[0].aliases.length,12,'笔名要全部带回，供用户选用');
 assert.deepEqual([...rows[0].aliases],names);
 assert.equal(candidates([{id:9,name:'artist_a',other_names:['x','',null,3,'  ','y']}])[0].aliases.length,2,'过滤掉非字符串与空白');
 assert.equal(candidates([{id:9,name:'artist_a'}])[0].aliases.length,0,'没有笔名字段时给空数组');
});
test('作品排序可切换，非法值一律退回最新发布',async()=>{
 const {posts}=require('./app/artist-lookup.js');
 const asked=[];
 const fetcher=async value=>{asked.push(new URL(value).searchParams.get('tags'));return {ok:true,json:async()=>[]};};
 await posts('artist_a',{limit:3,order:'favcount',fetcher});
 await posts('artist_a',{limit:3,order:'score',fetcher});
 await posts('artist_a',{limit:3,fetcher});
 await posts('artist_a',{limit:3,order:'score id:1..2',fetcher});
 await posts('artist_a',{limit:3,order:'RANK',fetcher});
 await posts('artist_a',{limit:3,order:'',fetcher});
 assert.deepEqual(asked,['artist_a order:favcount','artist_a order:score','artist_a order:id_desc','artist_a order:id_desc','artist_a order:id_desc','artist_a order:id_desc'],'默认与非法值都要退回最新发布，不能拼进查询');
});
test('画师详情取预览图时也按设置的排序',async()=>{
 const {details}=require('./app/artist-lookup.js');
 const asked=[];
 const fetcher=async value=>{const u=new URL(value);asked.push(u);return {ok:true,json:async()=>u.pathname==='/counts/posts.json'?{counts:{posts:5}}:[]};};
 await details('artist_a','',{previews:true,order:'favcount',fetcher});
 const list=asked.filter(u=>u.pathname==='/posts.json');
 assert.equal(list.length,1,'只请求一次作品列表');
 assert.equal(list[0].searchParams.get('tags'),'artist_a order:favcount');
});
test('作品接口优先走扩展：带登录态才拿得到图片地址，扩展不在或版本过旧时退回页面直连',async()=>{
 const {posts}=require('./app/artist-lookup.js');
 const rows=[{id:5,file_url:'https://cdn.donmai.us/original/a.jpg',preview_file_url:'https://cdn.donmai.us/180x180/a.jpg'}];
 const asked=[];
 globalThis.ArtistExtension={connected:true,canFetchApi:true,api:async url=>{asked.push(url);return {ok:true,status:200,json:async()=>rows};}};
 try{
  const works=await posts('artist_a',{limit:3});
  assert.equal(asked.length,1,'扩展连着且支持接口通道时应经扩展请求');
  assert.match(asked[0],/^https:\/\/danbooru\.donmai\.us\/posts\.json\?/);
  assert.equal(works[0].largeUrl,'https://cdn.donmai.us/original/a.jpg');
  assert.equal(works[0].thumbUrl,'https://cdn.donmai.us/360x360/a.jpg','只有 180 缩略图时自动换成 360');
 }finally{delete globalThis.ArtistExtension;}
 let pageCalls=0;const original=globalThis.fetch;
 globalThis.fetch=async()=>{pageCalls++;return {ok:true,json:async()=>rows};};
 try{
  for(const bridge of [{connected:false,canFetchApi:false,api:async()=>{throw Error('不该走扩展');}},{connected:true,canFetchApi:false,api:async()=>{throw Error('版本过旧不该走扩展');}}]){
   globalThis.ArtistExtension=bridge;
   const works=await posts('artist_a',{limit:3});
   assert.equal(works.length,1);
  }
  assert.equal(pageCalls,2,'扩展不在或版本过旧都要退回页面直连，而不是干等超时');
 }finally{globalThis.fetch=original;delete globalThis.ArtistExtension;}
});
test('读取画师详情时统一声明 JSON，预览地址才不会丢成 null',async()=>{
 const {details}=require('./app/artist-lookup.js');const requests=[];
 const rows=[{id:9,preview_file_url:'https://cdn.donmai.us/180x180/a.jpg',file_url:'https://cdn.donmai.us/original/a.jpg',media_asset:{variants:[{type:'720x720',url:'https://cdn.donmai.us/720x720/a.jpg'}]}}];
 const result=await details('artist_a','',{previews:true,fetcher:async(value,init)=>{const u=new URL(value);requests.push({u,init});return {ok:true,json:async()=>u.pathname==='/counts/posts.json'?{counts:{posts:5}}:rows};}});
 assert.equal(requests.length,2,'不带截止日期时只查数量与作品两件事');
 assert.ok(requests.every(r=>r.init.headers?.Accept==='application/json'),'每个请求都要声明 JSON；缺了它站点可能只回编号，作品地址全变 null');
 assert.equal(result.works.length,1);
 assert.equal(result.works[0].thumbUrl,'https://cdn.donmai.us/360x360/a.jpg');
 assert.equal(result.works[0].largeUrl,'https://cdn.donmai.us/original/a.jpg');
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
test('测试风格图片固定占右侧格子，序号 1 在最右，作品从左往右填空',()=>{
 const works=n=>Array.from({length:n},(_,i)=>({id:String(i+1)}));
 const test=seq=>({id:'',kind:'test',testSeq:seq});
 const mark=slots=>slots.map(w=>w?(w.kind==='test'?'测'+w.testSeq:w.id):'空');
 assert.deepEqual(mark(store.previewWorks({works:[...works(2),test(1)]})),['1','2','空','空','测1'],'只有 2 张作品时中间留空，测试图仍在最右');
 assert.deepEqual(mark(store.previewWorks({works:works(5)})),['1','2','3','4','5'],'没有测试图时照旧显示 5 张作品');
 assert.deepEqual(mark(store.previewWorks({works:[...works(2),test(1),test(2)]})),['1','2','空','测2','测1'],'序号 2 排在序号 1 的左边');
 assert.deepEqual(mark(store.previewWorks({works:[...works(6),test(1),test(2)]})),['1','2','3','测2','测1'],'作品让出被测试图占用的格子');
 assert.deepEqual(mark(store.previewWorks({works:works(3)})),['1','2','3','空','空'],'作品不足 5 张时后面留空');
 assert.deepEqual(mark(store.previewWorks({works:[...works(1),test(9)]})),['1','空','空','空','空'],'序号超出 5 格的测试图不显示');
 assert.deepEqual(store.previewWorks({works:[]}).length,5,'空画师也要返回 5 个格子');
 assert.equal(store.previewWorks({works:[...works(1),test(1)]})[4].testSeq,1);
});
test('固定测试风格图：右侧 2 格留给序号 1、2，作品图只占左边 3 格',()=>{
 const works=n=>Array.from({length:n},(_,i)=>({id:String(i+1)}));
 const test=seq=>({id:'',kind:'test',testSeq:seq});
 const mark=slots=>slots.map(w=>w?(w.kind==='test'?'测'+w.testSeq:w.id):'空');
 assert.deepEqual(mark(store.previewWorks({works:[...works(4),test(1),test(2)]},5,2)),['1','2','3','测2','测1'],'4 张作品也让出右侧 2 格');
 assert.deepEqual(mark(store.previewWorks({works:works(6)},5,2)),['1','2','3','空','空'],'没有测试图时右侧 2 格照样空着，不被作品挤占');
 assert.deepEqual(mark(store.previewWorks({works:[...works(2),test(2)]},5,2)),['1','2','空','测2','空'],'序号 2 固定在第 4 格');
 assert.deepEqual(mark(store.previewWorks({works:[...works(1),test(3)]},5,2)),['测3','1','空','空','空'],'序号 3 不占固定格，退回左边区域');
 assert.deepEqual(mark(store.previewWorks({works:[test(1),test(1)]},5,2)),['空','空','测1','空','测1'],'同一序号重复出现时退到左边，不抢序号 2 的固定格');
 assert.deepEqual(mark(store.previewWorks({works:works(3)},5,0)),['1','2','3','空','空'],'reserve 为 0 时行为与从前一致');
 assert.equal(store.previewWorks({works:[]},5,9).filter(Boolean).length,0,'保留格数超过格子数也不会越界');
});
test('拖进来的图片落到格子上：测试格按序号、作品格替换、空格子插到正确位置',()=>{
 const img=n=>({id:'',url:'',caption:'',thumb:'data:image/jpeg;base64,x'+n,large:null,thumbUrl:null,largeUrl:null});
 const works=n=>Array.from({length:n},(_,i)=>({id:String(i+1)}));
 const marks=list=>list.map(w=>w?(w.kind==='test'?'测'+w.testSeq:(w.thumb?'新':w.id)):'空');
 const order=list=>marks(list),layout=(list,reserve=2)=>marks(store.previewWorks({works:list},5,reserve));
 /* 固定测试格：拖到最右那格就变成测试风格 1 */
 let next=store.placeWork({works:works(2)},4,[img(1)],{limit:5,reserve:2});
 assert.deepEqual(layout(next),['1','2','空','空','测1'],'拖到最右的固定格 → 测试风格 1');
 assert.deepEqual(order(next),['1','2','测1']);
 /* 拖到已有测试图的固定格 → 替换那张，序号不变 */
 next=store.placeWork({works:[...works(2),{id:'',kind:'test',testSeq:1,thumb:'旧的'}]},4,[img(2)],{limit:5,reserve:2});
 assert.deepEqual(layout(next),['1','2','空','空','测1'],'替换固定格里的测试图');
 assert.equal(next.length,3,'替换而不是新增');
 assert.equal(next[2].kind,'test');assert.equal(next[2].testSeq,1,'序号仍然是 1');
 assert.equal(next[2].thumb,'data:image/jpeg;base64,x2','换成新拖进来的那张');
 /* 作品格：拖到空格子排到该位置，顺序不乱 */
 next=store.placeWork({works:works(2)},2,[img(3)],{limit:5,reserve:2});
 assert.deepEqual(order(next),['1','2','新'],'拖到第 3 格（空位）就排在那里');
 assert.deepEqual(layout(next),['1','2','新','空','空']);
 /* 没开固定格、中间被测试图占了一格：多张图往右填时会跳过那一格 */
 next=store.placeWork({works:[works(1)[0],{id:'',kind:'test',testSeq:3,thumb:'测试'}]},1,[img(1),img(2)],{limit:5,reserve:0});
 assert.deepEqual(layout(next,0),['1','新','测3','新','空'],'第 2 张跳过测试图占的格子，落到第 4 格');
 /* 作品格：拖到已有作品的格子 → 换掉那一格 */
 next=store.placeWork({works:works(3)},1,[img(4)],{limit:5,reserve:2});
 assert.deepEqual(order(next),['1','新','3'],'换掉第 2 格，长度不变');
 assert.equal(next.length,3);
 /* 一次拖多张：从这一格往右依次填，填到固定测试格就按那里的序号 */
 next=store.placeWork({works:works(1)},0,[img(5),img(6),img(7),img(8),img(9)],{limit:5,reserve:2});
 assert.deepEqual(layout(next),['新','新','新','测2','测1'],'第 4、5 张落到两个固定测试格上');
 assert.equal(next[3].kind,'test');assert.equal(next[3].testSeq,2);
 assert.equal(next[4].kind,'test');assert.equal(next[4].testSeq,1);
 next=store.placeWork({works:works(3)},0,[img(1),img(2),img(3)],{limit:5,reserve:2});
 assert.deepEqual(layout(next),['新','新','新','空','空'],'左边 3 格换完就没有空位了');
 next=store.placeWork({works:works(5)},0,[img(1),img(2)],{limit:5,reserve:0});
 assert.deepEqual(layout(next,0),['新','新','3','4','5'],'没开固定格时左边 5 格都是作品格');
 next=store.placeWork({works:works(5)},4,[img(1),img(2),img(3)],{limit:5,reserve:2});
 assert.equal(next.length,8,'格子用完了就追加到作品列表末尾');
 assert.equal(next[5].kind,'test','第一张进最右的固定测试格');assert.equal(next[5].testSeq,1);
 assert.equal(next[6].kind,undefined,'后面两张按普通作品追加');assert.equal(next[6].thumb,'data:image/jpeg;base64,x2');
 /* 没开固定格但那一格已经是测试图：按测试图处理，不当成作品格 */
 next=store.placeWork({works:[...works(4),{id:'',kind:'test',testSeq:1,thumb:'旧的'}]},4,[img(9)],{limit:5,reserve:0});
 assert.equal(next.length,5);assert.equal(next[4].kind,'test');assert.equal(next[4].testSeq,1);assert.equal(next[4].thumb,'data:image/jpeg;base64,x9');
 assert.deepEqual(store.placeWork({works:works(2)},0,[],{limit:5}),[{id:'1'},{id:'2'}],'没拖东西就原样返回');
 assert.deepEqual(store.placeWork(null,0,[img(1)]).length,1,'空画师也能放图');
 assert.equal(store.placeWork({works:[]},99,[img(1)],{limit:5,reserve:2})[0].kind,'test','格子号越界也要落在有效格子上');
});
test('导入用的测试风格序号：默认 1，已被占用就往后顺延',()=>{
 const test=seq=>({id:'',kind:'test',testSeq:seq});
 assert.equal(store.nextTestSeq([],1),1);
 assert.equal(store.nextTestSeq([{id:'1'}],1),1,'没有测试图时就用指定序号');
 assert.equal(store.nextTestSeq([test(1)],1),2,'序号 1 已被占用就顺延');
 assert.equal(store.nextTestSeq([test(1),test(2)],1),3);
 assert.equal(store.nextTestSeq([test(1),test(3)],1),2,'从空缺处补位');
 assert.equal(store.nextTestSeq([test(1),test(2)],3),3,'指定的 3 空着就直接用 3');
 assert.equal(store.nextTestSeq([test(1)],0),2,'序号填了非法值按 1 处理再顺延');
 assert.equal(store.nextTestSeq([{id:'',kind:'test'}],1),2,'没有序号字段的旧数据算作序号 1');
});
test('测试风格图片的标记与序号随保存、导出与恢复',async()=>{
 const dir=new Directory();
 await store.write(dir,{version:1,tags:[],artists:[{uid:'0001-a',name:'a',works:[{id:'1',thumb:png},{id:'',thumb:png,kind:'test',testSeq:2}]}]});
 const restored=await store.read(dir);
 assert.equal(restored.artists[0].works[1].kind,'test');
 assert.equal(restored.artists[0].works[1].testSeq,2,'序号不能在保存后丢失');
 const chunks=[];await store.exportTo(dir,restored,{write:async s=>chunks.push(s)});
 assert.equal(JSON.parse(chunks.join('')).artists[0].works[1].testSeq,2,'导出备份也要带序号');
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
test('导出只有地址不带图片数据：缩略图与原图都只留在线的那个',async()=>{
 const dir=new Directory();
 await store.write(dir,{version:1,tags:[],artists:[{uid:'0001-sample',name:'artist',works:[{id:'1',thumb:png,large:jpeg,thumbUrl:'https://cdn.donmai.us/360x360/a.jpg',largeUrl:'https://cdn.donmai.us/original/a.jpg'}]}]});
 const data=await store.read(dir),chunks=[];await store.exportTo(dir,data,{write:async s=>chunks.push(s)});const text=chunks.join(''),backup=JSON.parse(text),work=backup.artists[0].works[0];
 assert.equal(work.thumb,null,'本地缩略图不进备份');
 assert.equal(work.large,null,'本地原图不进备份');
 assert.equal(work.thumbUrl,'https://cdn.donmai.us/360x360/a.jpg','在线地址原样保留');
 assert.equal(work.largeUrl,'https://cdn.donmai.us/original/a.jpg','原图的在线链接保留，恢复后还能按链接取回');
 assert.equal(text.includes('base64'),false,'整份备份里不该有任何图片数据');
 assert.equal(text.length<400,true,'只有地址时备份应该很小，现在是 '+text.length+' 字符');
 const restoredDir=new Directory();await store.write(restoredDir,backup);const restored=await store.read(restoredDir);
 assert.equal(restored.artists[0].works[0].thumb,null,'恢复出来没有本地缩略图');
 assert.equal(restored.artists[0].works[0].thumbUrl,'https://cdn.donmai.us/360x360/a.jpg','卡片要能按链接把缩略图取回来');
});
test('导出不带图片数据：上传或生成的原图没有在线链接，字段一并留空',async()=>{
 const dir=new Directory();
 await store.write(dir,{version:1,tags:[],artists:[{uid:'0001-only',name:'artist',works:[{id:'',kind:'test',testSeq:1,thumb:jpeg,large:png}]}]});
 const data=await store.read(dir),chunks=[];await store.exportTo(dir,data,{write:async s=>chunks.push(s)});const text=chunks.join(''),work=JSON.parse(text).artists[0].works[0];
 assert.equal(work.thumb,null);
 assert.equal(work.large,null);
 assert.ok(!work.thumbUrl,'本来就没有链接，不能编一个出来');
 assert.ok(!work.largeUrl);
 assert.equal(work.kind,'test');assert.equal(work.testSeq,1,'标记与序号照旧保留');
 assert.equal(text.includes('base64'),false);
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
