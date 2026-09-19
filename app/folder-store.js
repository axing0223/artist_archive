(function(root){
  'use strict';
  const ArtistId=root.ArtistId||(typeof module!=='undefined'?require('./artist-id.js'):null);
  const IMAGE_KINDS=['thumb','large'],SIZES=['thumb','preview','large'],FOLDER_OF={thumb:'缩略图',large:'大图'},LEGACY_FOLDER='预览图',MAX_IMAGE_BYTES=50*1024*1024;
  const TYPES={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif'};
  const imageNamePattern=/^[a-f0-9]{24}\.(jpeg|png|webp|gif|avif)$/;
  const imagePathPattern=/^(?:缩略图|大图)\/[a-f0-9]{24}\.(?:jpeg|png|webp|gif|avif)$/;
  const inlinePattern=/^data:image\/(jpeg|png|webp|gif|avif);base64,([a-zA-Z0-9+/=\s]+)$/;
  const remotePattern=/^https:\/\/\S+$/;
  const snapshots=new WeakMap(),legacy=new WeakMap(),warnings=[];
  const warn=message=>warnings.push(message);
  function takeWarnings(){const list=warnings.slice();warnings.length=0;return list;}
  const signature=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  function remember(dir,data){snapshots.set(dir,new Map(data.artists.map(a=>[a.uid,signature(a)])));}
  /* 登记一次 uid 变更（改名、补编号）。下一次 write 会把旧目录里的图片搬到新目录再删旧目录；
     不登记的话新目录是空的，而旧目录照样会被清理，图片就丢了。 */
  function rename(dir,from,to){if(!dir||!from||!to||from===to)return;const map=legacy.get(dir)||new Map();map.set(to,from);legacy.set(dir,map);}
  const empty=()=>({version:1,cutoffDate:'2026-07-01',saveLargeImages:false,fixedTestSlots:false,tags:['可爱','唯美','暗黑','酷炫','清爽','华丽'],artists:[]});
  async function json(dir,name){return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());}
  async function put(dir,name,value){const f=await dir.getFileHandle(name,{create:true}),s=await f.createWritable();try{await s.write(value);await s.close();}catch(e){try{await s.abort();}catch{}throw e;}}
  const extensionOf=type=>Object.keys(TYPES).find(k=>TYPES[k]===type)||'';
  const base64Of=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
  const hashOf=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,24);
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
  async function saveImage(dir,uid,kind,blob){
    if(!IMAGE_KINDS.includes(kind))throw Error('图片类型错误：'+kind);
    if(!ArtistId.valid(uid))throw Error('画师标识格式错误');
    if(!blob||typeof blob.arrayBuffer!=='function'||!blob.size)throw Error('图片内容为空');
    if(blob.size>MAX_IMAGE_BYTES)throw Error('图片超过 '+(MAX_IMAGE_BYTES/1024/1024)+' MB');
    const extension=extensionOf(blob.type);
    if(!extension)throw Error('不支持的图片格式：'+(blob.type||'未知'));
    const bytes=new Uint8Array(await blob.arrayBuffer()),name=(await hashOf(bytes))+'.'+extension;
    const folder=await artistFolder(dir,uid,true),images=await folder.getDirectoryHandle(FOLDER_OF[kind],{create:true});
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
    let index;try{index=await json(dir,'画师库.json');}catch(e){if(e.name!=='NotFoundError')throw e;for await(const entry of dir.values())throw Error('请选择现有「数据」文件夹，或一个空文件夹。');snapshots.set(dir,new Map());legacy.set(dir,new Map());return empty();}
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
    let entries;try{entries=source;}catch{return;}
    for await(const entry of entries.values()){
      if(entry.kind!=='file'||!imageNamePattern.test(entry.name))continue;
      const file=await entry.getFile();
      if(file.size>MAX_IMAGE_BYTES)continue;
      await put(target,entry.name,new Uint8Array(await file.arrayBuffer()));
    }
  }
  async function exportTo(dir,data,stream,progress=()=>{}){
    const {artists,...header}=data;await stream.write(JSON.stringify(header).slice(0,-1)+',"artists":[');
    for(let i=0;i<artists.length;i++){const {works,...meta}=artists[i];progress(i+1,artists.length);await stream.write((i?',':'')+JSON.stringify(meta).slice(0,-1)+',"works":[');
      for(let j=0;j<works.length;j++){const copy={...works[j]};
        for(const kind of IMAGE_KINDS){const value=copy[kind];if(typeof value==='string'&&!value.startsWith('data:')){const blob=await readImage(dir,meta.uid,value);copy[kind]='data:'+blob.type+';base64,'+base64Of(new Uint8Array(await blob.arrayBuffer()));}}
        await stream.write((j?',':'')+JSON.stringify(copy));}
      await stream.write(']}');}
    await stream.write(']}');
  }
  async function write(dir,data){
    if(data.version!==1||!Array.isArray(data.artists)||data.artists.length>20000)throw Error('画师库格式错误');
    const ids=new Set();for(const a of data.artists){if(!ArtistId.valid(a.uid)||ids.has(a.uid)||!Array.isArray(a.works))throw Error('画师标识格式错误');ids.add(a.uid);if(a.works.some(w=>!validWork(w)))throw Error('图片格式错误');}
    let previous=[];try{previous=(await json(dir,'画师库.json')).artists;}catch(e){if(e.name!=='NotFoundError')throw e;}
    const before=snapshots.get(dir)||new Map(),mapped=legacy.get(dir)||new Map(),moved=new Map(mapped),records=new Map(),artists=await dir.getDirectoryHandle('画师',{create:true}),result={...data,artists:[]},cleanup=[];
    for(const a of data.artists){
      const stamp=signature(a);
      if(!moved.has(a.uid)&&before.get(a.uid)===stamp){records.set(a.uid,stamp);result.artists.push(a);continue;}
      const oldUid=moved.get(a.uid);if(oldUid)mapped.delete(a.uid);
      const folder=await artists.getDirectoryHandle(a.uid,{create:true}),copy=structuredClone(a),used={};
      for(const kind of IMAGE_KINDS){
        const images=await folder.getDirectoryHandle(FOLDER_OF[kind],{create:true});used[kind]=new Set();
        /* uid 变了（改名或补编号）时要把旧目录的图片搬过来，否则稍后旧目录会被删掉，
           图片就没了。缩略图可能还在旧版的「预览图」目录里，所以两处都找。 */
        if(oldUid){
          const from=await artists.getDirectoryHandle(oldUid),sources=kind==='thumb'?[FOLDER_OF[kind],LEGACY_FOLDER]:[FOLDER_OF[kind]];
          for(const name of sources)try{await copyImages(await from.getDirectoryHandle(name),images);}
          catch(error){if(error.name!=='NotFoundError')warn('旧图片迁移失败（'+error.message+'）');}
        }
      }
      for(const w of copy.works){
        for(const kind of IMAGE_KINDS)if(typeof w[kind]==='string'&&w[kind].startsWith('data:'))w[kind]=await saveImage(dir,a.uid,kind,blobOf(w[kind]));
        for(const kind of IMAGE_KINDS)if(typeof w[kind]==='string')used[kind].add(w[kind].split('/').pop());
      }
      await put(folder,'信息.json',JSON.stringify(copy,null,2));records.set(a.uid,signature(copy));result.artists.push(copy);cleanup.push({folder,used});
    }
    await put(dir,'画师库.json',JSON.stringify({...data,artists:[...ids]},null,2));snapshots.set(dir,records);legacy.set(dir,new Map());
    for(const {folder,used} of cleanup)for(const kind of IMAGE_KINDS)try{const images=await folder.getDirectoryHandle(FOLDER_OF[kind]);for await(const entry of images.values())if(entry.kind==='file'&&imageNamePattern.test(entry.name)&&!used[kind].has(entry.name))await images.removeEntry(entry.name);}catch(error){warn('旧图片清理失败（'+error.message+'）');}
    /* 下面两段会删到同一批目录：登记过改名的旧目录，往往就是上一次索引里有、这次没有的那个。
       第一段删掉之后第二段再删只会报「找不到」，可那正说明目的已经达到，不该当成失败。
       真正需要报出来的是权限、占用这类错误。 */
    const removed=new Set();
    for(const id of previous)if(ArtistId.valid(id)&&!ids.has(id))try{await artists.removeEntry(id,{recursive:true});removed.add(id);}catch(error){if(error.name!=='NotFoundError')warn('画师 '+id+' 的目录删除失败（'+error.message+'）');}
    for(const oldUid of moved.values())if(ArtistId.valid(oldUid)&&!ids.has(oldUid)&&!removed.has(oldUid))try{await artists.removeEntry(oldUid,{recursive:true});removed.add(oldUid);}catch(error){if(error.name!=='NotFoundError')warn('旧目录 '+oldUid+' 删除失败（'+error.message+'）');}
    return result;
  }
  root.FolderStore={read,write,readImage,saveImage,imageOf,previewWorks,nextTestSeq,validWork,exportTo,remember,rename,empty,takeWarnings,IMAGE_KINDS,SIZES,FOLDER_OF,MAX_IMAGE_BYTES};
  if(typeof module!=='undefined')module.exports=root.FolderStore;
})(globalThis);
