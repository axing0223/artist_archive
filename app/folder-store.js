(function(root){
  'use strict';
  const ArtistId=root.ArtistId||(typeof module!=='undefined'?require('./artist-id.js'):null);
  const IMAGE_KINDS=['thumb','large'],SIZES=['thumb','preview','large'],FOLDER_OF={thumb:'缩略图',large:'大图'},LEGACY_FOLDER='预览图',MAX_IMAGE_BYTES=50*1024*1024;
  /* 落盘并发度：每位画师的目录互相独立，串行写是白等。取 6 与 app/image-loader.js 的取图并发 3
     保持同一量级——再高只是在抢同一个磁盘队列，收益有限。 */
  const WRITE_CONCURRENCY=6;
  const TYPES={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif'};
  /* 图片文件名两种都认：老图片是内容哈希（24 位十六进制），新的测试风格图叫「画师tag-测试风格N.png」。
     ownedNamePattern 只匹配我们自己写出来的这两种名字，清理与迁移都按它来，
     用户自己丢进「缩略图 / 大图」的其它文件不动。 */
  const NAME_CHARS='[^\\u0000-\\u001f\\\\/:*?"<>|][^\\u0000-\\u001f\\\\/:*?"<>|]{0,99}',EXT='(?:jpeg|png|webp|gif|avif)';
  const imageNamePattern=new RegExp('^(?:[a-f0-9]{24}|'+NAME_CHARS+'\\.'+EXT+')$');
  const ownedNamePattern=new RegExp('^(?:[a-f0-9]{24}|'+NAME_CHARS+'-测试风格\\d{1,3})\\.'+EXT+'$');
  const imagePathPattern=new RegExp('^(?:缩略图|大图)\\/(?:[a-f0-9]{24}|'+NAME_CHARS+'\\.'+EXT+')$');
  const inlinePattern=/^data:image\/(jpeg|png|webp|gif|avif);base64,([a-zA-Z0-9+/=\s]+)$/;
  const remotePattern=/^https:\/\/\S+$/;
  const snapshots=new WeakMap(),legacy=new WeakMap(),indexText=new WeakMap(),warnings=[];
  const warn=message=>warnings.push(message);
  function takeWarnings(){const list=warnings.slice();warnings.length=0;return list;}
  /* order 不进指纹：它就是画师在 画师库.json 里的位置，读回来一律按位置重排，
     写进 信息.json 的那份只是顺手记一笔，谁都不拿它当依据。
     把它算进指纹的话，删掉中间一位画师（后面所有人序号前移）会让后面每位画师都「看起来变了」，
     于是每一位的 信息.json 连同三个图片目录都要重新走一遍磁盘——两百多位就是上千次往返，界面卡两秒。 */
  const signature=value=>JSON.stringify(value,(key,v)=>key==='order'?undefined:v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  /* 试过在这里按对象身份做一层 WeakMap 缓存，实测没有收益，已撤掉。原因值得记下来：
     页面每次保存前都会 clone(data)（app.js 的 save），于是「没变的画师」每次都是**新对象**，
     按身份缓存必然 0 命中。要真省下这笔整库 JSON.stringify，得让应用不再整库克隆，
     那是 app 侧的改动，不是这里的缓存能解决的。 */
  function remember(dir,data){snapshots.set(dir,new Map(data.artists.map(a=>[a.uid,signature(a)])));}
  /* 登记一次 uid 变更（改名、补编号）。下一次 write 会把旧目录里的图片搬到新目录再删旧目录；
     不登记的话新目录是空的，而旧目录照样会被清理，图片就丢了。 */
  function rename(dir,from,to){if(!dir||!from||!to||from===to)return;const map=legacy.get(dir)||new Map();map.set(to,from);legacy.set(dir,map);}
  const empty=()=>({version:1,cutoffDate:'2026-07-01',saveLargeImages:false,fixedTestSlots:false,tags:['可爱','唯美','暗黑','酷炫','清爽','华丽'],artists:[]});
  async function json(dir,name){return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());}
  async function put(dir,name,value){const f=await dir.getFileHandle(name,{create:true}),s=await f.createWritable();try{await s.write(value);await s.close();}catch(e){try{await s.abort();}catch{}throw e;}}
  const extensionOf=type=>Object.keys(TYPES).find(k=>TYPES[k]===type)||'';
  const hashOf=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,24);
  /* data: URL → Blob。不用 fetch(data:) 转：扩展页的 CSP（connect-src）会拦住 data:，
     而这条路正是「选了作品还没保存」时缩略图要走的显示路径。 */
  function blobOf(value){
    const m=inlinePattern.exec(value);
    if(!m)throw Error('图片来源格式错误，只接受 data: 或 https:// 链接');
    const bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));
    return new Blob([bytes],{type:'image/'+m[1]});
  }
  const okImage=value=>value==null||(typeof value==='string'&&(imagePathPattern.test(value)||inlinePattern.test(value)||remotePattern.test(value)));
  function validWork(w){return !!w&&typeof w==='object'&&IMAGE_KINDS.every(kind=>okImage(w[kind])&&okImage(w[kind+'Url']))&&okImage(w.previewUrl);}
  function nextTestSeq(works,want=1){
    const used=new Set((Array.isArray(works)?works:[]).filter(w=>w.kind==='test').map(w=>Number.isSafeInteger(w.testSeq)&&w.testSeq>0?w.testSeq:1));
    let seq=Number.isSafeInteger(want)&&want>0?want:1;
    while(used.has(seq))seq++;
    return seq;
  }
  /* 卡片预览格排布。默认 5 格、测试风格图按序号从右往左占位、作品图从左往右补空。
     reserve>0 时（设置里开了「固定测试风格图」）最右 reserve 格留给序号 1..reserve 的测试图：
     作品图只能用到左边的 limit-reserve 格，测试图还没生成时这几格也不会被作品挤占。 */
  function previewWorks(artist,limit=5,reserve=0){
    const works=Array.isArray(artist?.works)?artist.works:[],slots=new Array(limit).fill(null);
    const fixed=Math.max(0,Math.min(Number.isSafeInteger(reserve)&&reserve>0?reserve:0,limit)),cut=limit-fixed;
    const seqOf=work=>Number.isSafeInteger(work.testSeq)&&work.testSeq>0?work.testSeq:1;
    for(const work of works){
      if(work.kind!=='test')continue;
      const seq=seqOf(work),primary=seq<=fixed?limit-seq:cut-seq;
      /* 固定格只认自己的序号：同一个序号重复出现时退到左边区域找空位，不去抢别的固定格。 */
      let index=slots[primary]?cut-1:primary;
      while(index>=0&&slots[index])index--;
      if(index>=0)slots[index]=work;
    }
    let cursor=0;
    for(const work of works){
      if(work.kind==='test')continue;
      while(cursor<cut&&slots[cursor])cursor++;
      if(cursor>=cut)break;
      slots[cursor]=work;cursor++;
    }
    return slots;
  }
  /* 把拖进来的图片落到第 index 格，返回新的 works 数组（不改原对象）。
     规则：那一格是测试格（固定测试格，或现在正显示测试图）就按该格的序号替换；
     是作品格就换掉那一格的图；空格子按从左往右的顺序插进去；
     一张拖不下就往右依次填，5 格都用完了就追加到作品列表末尾。 */
  function placeWork(artist,index,added,{limit=5,reserve=0}={}){
    const works=Array.isArray(artist?.works)?artist.works.slice():[],incoming=(Array.isArray(added)?added:[]).filter(Boolean);
    if(!incoming.length)return works;
    const fixed=Math.max(0,Math.min(reserve,limit)),cut=limit-fixed;
    let at=Math.max(0,Math.min(Number.isSafeInteger(index)?index:0,limit-1));
    for(const raw of incoming){
      if(at>=limit){works.push({...raw});at++;continue;}
      const slots=previewWorks({works},limit,reserve);
      /* 已经被别的测试图占掉的格子跳过（只可能出现在没开固定格的时候）。 */
      while(at>index&&at<cut&&slots[at]&&slots[at].kind==='test')at++;
      if(at>=limit){works.push({...raw});at++;continue;}
      const current=slots[at]||null,isTest=at>=cut||!!(current&&current.kind==='test');
      const entry=isTest?{...raw,kind:'test',testSeq:Math.max(1,limit-at)}:{...raw};
      if(current){const seat=works.indexOf(current);if(seat>=0)works[seat]=entry;else works.push(entry);}
      /* 空格子：作品是从左往右填的，所以空格子一定在所有已显示作品之后，直接排到末尾就是它。 */
      else works.push(entry);
      at++;
    }
    return works;
  }
  function imageOf(work,size){
    if(!work||!SIZES.includes(size))return null;
    const file=work[size],url=work[size+'Url'];
    if(typeof file==='string'&&imagePathPattern.test(file))return {kind:'local',path:file};
    if(typeof file==='string'&&inlinePattern.test(file))return {kind:'inline',data:file};
    if(typeof url==='string'&&remotePattern.test(url))return {kind:'remote',url};
    if(size==='preview'&&typeof work.largeUrl==='string'&&remotePattern.test(work.largeUrl))return {kind:'remote',url:work.largeUrl};
    if(typeof url==='string'&&inlinePattern.test(url))return {kind:'inline',data:url};
    return null;
  }
  function normalizeWork(w){
    if(IMAGE_KINDS.some(kind=>typeof w[kind]==='string'))return w;
    const next={...w};
    if(typeof next.file==='string')next.thumb=imagePathPattern.test(next.file.replace(/^预览图\//,'缩略图/'))?next.file.replace(/^预览图\//,'缩略图/'):null;
    if(typeof next.image==='string'){if(inlinePattern.test(next.image)&&!inlinePattern.test(String(next.thumb||'')))next.thumb=next.image;else if(remotePattern.test(next.image))next.thumbUrl=next.image;}
    delete next.file;delete next.image;
    return next;
  }
  async function artistFolder(dir,uid,create=false){
    const artists=await dir.getDirectoryHandle('画师',{create});
    const stored=(legacy.get(dir)||new Map()).get(uid)||uid;
    return artists.getDirectoryHandle(stored,{create});
  }
  async function saveImage(dir,uid,kind,blob,preferredName){
    if(!IMAGE_KINDS.includes(kind))throw Error('图片类型错误：'+kind);
    if(!ArtistId.valid(uid))throw Error('画师标识格式错误');
    /* 草稿（draft-…）还没有正式标识。让它落盘就会在「画师」下留一个没人认领的目录：
       它不在索引里，扫描与清理都够不到，删画师也删不到它。宁可在入口就拒绝。 */
    if(/^draft-/.test(uid))throw Error('草稿还没有正式标识，不能写入画师目录');
    return saveImageIn(await artistFolder(dir,uid,true),kind,blob,preferredName);
  }
  async function saveImageIn(folder,kind,blob,preferredName){
    if(!blob||typeof blob.arrayBuffer!=='function'||!blob.size)throw Error('图片内容为空');
    if(blob.size>MAX_IMAGE_BYTES)throw Error('图片超过 '+(MAX_IMAGE_BYTES/1024/1024)+' MB');
    const extension=extensionOf(blob.type);
    if(!extension)throw Error('不支持的图片格式：'+(blob.type||'未知'));
    const bytes=new Uint8Array(await blob.arrayBuffer());
    const name=preferredName?preferredName+'.'+extension:(await hashOf(bytes))+'.'+extension;
    const images=await folder.getDirectoryHandle(FOLDER_OF[kind],{create:true});
    await put(images,name,bytes);
    return FOLDER_OF[kind]+'/'+name;
  }
  async function readImage(dir,uid,path){
    if(!ArtistId.valid(uid)||!imagePathPattern.test(path))throw Error('图片路径错误');
    const [kind,name]=path.split('/'),folder=await artistFolder(dir,uid);
    const pending=(legacy.get(dir)||new Map()).has(uid)&&kind===FOLDER_OF.thumb;
    let blob=null;for(const candidate of pending?[LEGACY_FOLDER,kind]:[kind]){
      try{blob=await (await (await folder.getDirectoryHandle(candidate)).getFileHandle(name)).getFile();break;}catch{}
    }
    if(!blob)throw Error('图片不存在：'+path);
    if(blob.size>MAX_IMAGE_BYTES)throw Error('图片超过 '+(MAX_IMAGE_BYTES/1024/1024)+' MB');
    return new Blob([blob],{type:TYPES[name.split('.').pop()]||'application/octet-stream'});
  }
  async function read(dir){
    let index;try{const text=await (await (await dir.getFileHandle('画师库.json')).getFile()).text();index=JSON.parse(text);indexText.set(dir,text);}
    catch(e){if(e.name!=='NotFoundError')throw e;for await(const entry of dir.values())throw Error('请选择现有「数据」文件夹，或一个空文件夹。');snapshots.set(dir,new Map());legacy.set(dir,new Map());indexText.set(dir,null);return empty();}
    if(index.version!==1||!Array.isArray(index.artists)||index.artists.length>20000||index.artists.some(id=>!ArtistId.valid(id)))throw Error('画师库索引格式错误');
    const taken=new Set(),seqOf=new Map();
    for(const stored of index.artists){const p=ArtistId.parse(stored);seqOf.set(stored,p?p.seq:null);if(p)taken.add(p.seq);}
    let free=1;for(const stored of index.artists)if(seqOf.get(stored)===null){while(taken.has(free))free++;seqOf.set(stored,free);taken.add(free);}
    const data={...index,artists:[]},records=new Map(),moved=new Map(),slots=new Array(index.artists.length).fill(null);
    if(index.artists.length){const artists=await dir.getDirectoryHandle('画师');let cursor=0;
      await Promise.all(Array.from({length:Math.min(8,index.artists.length)},async()=>{while(cursor<index.artists.length){
        const i=cursor++,stored=index.artists[i];let a=null;
        /* 索引里有、盘上没有的画师不能拖垮整个加载：跳过并记一条警告。
           否则只要有一位目录缺失，整个画师库就再也打不开。 */
        try{a=await json(await artists.getDirectoryHandle(stored),'信息.json');}
        catch(error){if(error.name!=='NotFoundError')throw error;warn('画师目录缺失，已跳过：'+stored);continue;}
        if(a.uid!==stored||!Array.isArray(a.works)||a.works.some(w=>!validWork(w)))throw Error('画师资料格式错误：'+stored);
        const uid=ArtistId.parse(stored)?stored:ArtistId.create({seq:seqOf.get(stored),name:a.name,danbooruId:a.danbooruId});
        if(uid!==stored)moved.set(uid,stored);
        const artist={...a,uid,order:i+1,works:a.works.map(normalizeWork)};
        slots[i]=artist;records.set(uid,signature(artist));
      }}));
      data.artists=slots.filter(Boolean).map((artist,i)=>({...artist,order:i+1}));
    }
    snapshots.set(dir,records);legacy.set(dir,moved);return data;
  }
  async function copyImages(source,target){
    for await(const entry of source.values()){
      // 用户放在图片目录里的文件也要保留；遇到无法迁移的内容，保留整个源目录。
      if(entry.kind!=='file')throw Error('图片目录含有子目录，请先手动迁移：'+entry.name);
      const file=await entry.getFile();
      if(file.size>MAX_IMAGE_BYTES)throw Error('迁移图片超过大小限制：'+entry.name);
      await put(target,entry.name,new Uint8Array(await file.arrayBuffer()));
    }
  }
  /* 测试风格图按「画师tag-测试风格N」命名，方便在资源管理器里直接认出来是哪位画师的哪一格。
     同一批里重名时往后加序号，绝不让后一张悄悄盖掉前一张。 */
  function testImageName(artistName,testSeq){
    const seq=Number.isSafeInteger(testSeq)&&testSeq>0?testSeq:1;
    const tag=String(artistName||'').replace(/[\u0000-\u001f\\/:*?"<>|]/g,'_').trim().slice(0,80)||'画师';
    return tag+'-测试风格'+seq;
  }
  /* 导出备份：只有资料与地址，不带任何图片数据——缩略图与原来一样只留在线链接。
     这样备份体积基本等于纯文本（几十 KB 级），代价是恢复后看图要联网按链接取；
     链接指向的图被站点删掉就再也回不来，所以「要留下图本身」只能复制整个「数据」文件夹。 */
  async function exportTo(dir,data,stream,progress=()=>{}){
    const {artists,...header}=data;await stream.write(JSON.stringify(header).slice(0,-1)+',"artists":[');
    for(let i=0;i<artists.length;i++){const {works,...meta}=artists[i];progress(i+1,artists.length);await stream.write((i?',':'')+JSON.stringify(meta).slice(0,-1)+',"works":[');
      for(let j=0;j<works.length;j++){const copy={...works[j]};
        for(const kind of IMAGE_KINDS)copy[kind]=typeof copy[kind]==='string'&&remotePattern.test(copy[kind])?copy[kind]:null;
        await stream.write((j?',':'')+JSON.stringify(copy));}
      await stream.write(']}');}
    await stream.write(']}');
  }
  /* 只写「信息.json」的落盘路径（改标签名、删标签这类纯元数据改动）。
     走进来时已经确认过：这位画师的图片只以本地路径或在线链接存在，没有待落盘的 data: 图，
     所以既不用打开图片目录，也不该做旧图清理——那两笔开销跟元数据毫无关系。
     返回写进文件的那份对象；调用方负责按它更新指纹与结果数组。 */
  async function writeArtistMeta(artists,a){
    const folder=await artists.getDirectoryHandle(a.uid,{create:true}),copy={...a,uid:a.uid};
    await put(folder,'信息.json',JSON.stringify(copy,null,2));
    return copy;
  }
  async function write(dir,data,mode=null){
    if(data.version!==1||!Array.isArray(data.artists)||data.artists.length>20000)throw Error('画师库格式错误');
    const ids=new Set();for(const a of data.artists){if(!ArtistId.valid(a.uid)||ids.has(a.uid)||!Array.isArray(a.works))throw Error('画师标识格式错误');ids.add(a.uid);if(a.works.some(w=>!validWork(w)))throw Error('图片格式错误');}
    let previous=[];try{previous=(await json(dir,'画师库.json')).artists;}catch(e){if(e.name!=='NotFoundError')throw e;}
    const before=snapshots.get(dir)||new Map(),mapped=legacy.get(dir)||new Map(),moved=new Map(mapped),records=new Map(),artists=await dir.getDirectoryHandle('画师',{create:true}),result={...data,artists:new Array(data.artists.length)},cleanup=[];
    /* meta：本次只动元数据，别碰图片——除非有画师正带着没落盘的 data: 图（那说明调用方判断错了，
       这种情况下按完整路径走，宁可慢也不能把图片引用清掉）。 */
    let meta=mode==='meta';
    if(meta)for(const a of data.artists)if(a.works.some(w=>IMAGE_KINDS.some(kind=>typeof w[kind]==='string'&&w[kind].startsWith('data:')))){meta=false;break;}
    /* 逐个画师落盘。每人的目录互相独立，所以可以并发；但**输出位置必须先定好**：
       并发完成顺序不等于原顺序，若按完成顺序 push，画师顺序（也就是索引顺序）会被打乱。
       索引必须在所有人写完之后再提交（下面那一步），否则中途失败会留下"索引里有、盘上没有"的残局。
       注意：跳过落盘的三个分支在 await 之前就返回了，所以并发不会打乱它们的判定。 */
    const finish=async(a,index)=>{
      const stamp=signature(a);
      if(meta&&!moved.has(a.uid)&&before.get(a.uid)===stamp){records.set(a.uid,stamp);result.artists[index]=a;return;}
      if(meta){const copy=await writeArtistMeta(artists,a);records.set(a.uid,signature(copy));result.artists[index]=copy;return;}
      /* !moved.has(uid) 这一半不是冗余：uid 迁移过（旧库升级 / 改名补编号）时指纹必然一致，
         可磁盘上该做的是「把旧目录的图片搬到新目录」。少了它就会跳过整个循环体，
         新目录不会建、旧目录却在后面被当成废弃目录删掉——图片直接丢。 */
      if(!moved.has(a.uid)&&before.get(a.uid)===stamp){records.set(a.uid,stamp);result.artists[index]=a;return;}
      const oldUid=moved.get(a.uid); // 索引提交前保留映射，失败后仍可读旧图并重试。
      const folder=await artists.getDirectoryHandle(a.uid,{create:true}),copy=structuredClone(a),used={},taken={};
      for(const kind of IMAGE_KINDS){
        const images=await folder.getDirectoryHandle(FOLDER_OF[kind],{create:true});used[kind]=new Set();taken[kind]=new Set();
        /* uid 变了（改名或补编号）时要把旧目录的图片搬过来，否则稍后旧目录会被删掉，
           图片就没了。缩略图可能还在旧版的「预览图」目录里，所以两处都找。 */
        if(oldUid){
          const from=await artists.getDirectoryHandle(oldUid),sources=kind==='thumb'?[FOLDER_OF[kind],LEGACY_FOLDER]:[FOLDER_OF[kind]];
          for(const name of sources){
            let source;
            try{source=await from.getDirectoryHandle(name);}
            catch(error){if(error.name==='NotFoundError')continue;throw error;}
            await copyImages(source,images);
          }
        }
      }
      for(const w of copy.works){
        for(const kind of IMAGE_KINDS)if(typeof w[kind]==='string'&&w[kind].startsWith('data:')){
          /* 测试风格图用人读得懂的名字落盘，缩略图与大图各自带自己的扩展名。 */
          let base=null;
          if(w.kind==='test'){
            const wanted=testImageName(a.name,w.testSeq);
            base=wanted;let n=2;while(taken[kind].has(base))base=wanted+'-'+n++;
            taken[kind].add(base);
          }
          w[kind]=await saveImageIn(folder,kind,blobOf(w[kind]),base);
        }
        for(const kind of IMAGE_KINDS)if(typeof w[kind]==='string')used[kind].add(w[kind].split('/').pop());
      }
      if(oldUid)for(const work of copy.works)for(const kind of IMAGE_KINDS){
        const ref=imageOf(work,kind);
        if(ref?.kind==='local'){
          const [sub,name]=ref.path.split('/');
          await (await (await folder.getDirectoryHandle(sub)).getFileHandle(name)).getFile();
        }
      }
      await put(folder,'信息.json',JSON.stringify(copy,null,2));records.set(a.uid,signature(copy));result.artists[index]=copy;cleanup.push({folder,used});
    };
    /* 并发池。索引写盘那一步必须在所有画师落盘之后，所以这里等的是全部任务。
       出错时先立起 stopped 让还在跑的 worker 停下（否则重跑一遍会白写几百个文件），
       再把已经在飞的任务收干净，最后抛出第一个错误。 */
    let cursor=0,firstError=null,stopped=false;
    const worker=async()=>{
      while(!stopped&&cursor<data.artists.length){const index=cursor++;await finish(data.artists[index],index);}
    };
    const workers=Array.from({length:Math.max(1,Math.min(WRITE_CONCURRENCY,data.artists.length))},worker);
    try{
      await Promise.all(workers);
    }catch(error){
      stopped=true;firstError=error;
      await Promise.allSettled(workers);
    }
    if(firstError)throw firstError;
    /* 索引只在内容真的变了时才写。它随画师人数线性变大（1200 位时一次约 89 ms，
       比所有画师文件加起来还贵），而「只改标签名 / 改设置」这类操作经常连它一起没变——
       序列化照做（这是判定的代价），但那一笔写盘可以省掉。 */
    const index=JSON.stringify({...data,artists:[...ids]},null,2);
    if(indexText.get(dir)!==index){await put(dir,'画师库.json',index);indexText.set(dir,index);}
    snapshots.set(dir,records);legacy.set(dir,new Map());
    for(const {folder,used} of cleanup)for(const kind of IMAGE_KINDS)try{const images=await folder.getDirectoryHandle(FOLDER_OF[kind]);for await(const entry of images.values())if(entry.kind==='file'&&ownedNamePattern.test(entry.name)&&!used[kind].has(entry.name))await images.removeEntry(entry.name);}catch(error){warn('旧图片清理失败（'+error.message+'）');}
    /* 下面两段会删到同一批目录：登记过改名的旧目录，往往就是上一次索引里有、这次没有的那个。
       第一段删掉之后第二段再删只会报「找不到」，可那正说明目的已经达到，不该当成失败。
       真正需要报出来的是权限、占用这类错误。 */
    const removed=new Set();
    for(const id of previous)if(ArtistId.valid(id)&&!ids.has(id))try{await artists.removeEntry(id,{recursive:true});removed.add(id);}catch(error){if(error.name!=='NotFoundError')warn('画师 '+id+' 的目录删除失败（'+error.message+'）');}
    for(const oldUid of moved.values())if(ArtistId.valid(oldUid)&&!ids.has(oldUid)&&!removed.has(oldUid))try{await artists.removeEntry(oldUid,{recursive:true});removed.add(oldUid);}catch(error){if(error.name!=='NotFoundError')warn('旧目录 '+oldUid+' 删除失败（'+error.message+'）');}
    return result;
  }
  root.FolderStore={read,write,readImage,saveImage,imageOf,blobOf,previewWorks,placeWork,nextTestSeq,testImageName,validWork,exportTo,remember,rename,empty,takeWarnings,IMAGE_KINDS,SIZES,FOLDER_OF,MAX_IMAGE_BYTES};
  if(typeof module!=='undefined')module.exports=root.FolderStore;
})(globalThis);
