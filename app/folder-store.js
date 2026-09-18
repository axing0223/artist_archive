(function(root){
  'use strict';
  const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
  const filePattern=/^预览图\/[a-f0-9]{24}\.(jpeg|png|webp|gif|avif)$/;
  const snapshots=new WeakMap(),warnings=[];
  const warn=message=>warnings.push(message);
  function takeWarnings(){const list=warnings.slice();warnings.length=0;return list;}
  const signature=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  function remember(dir,data){snapshots.set(dir,new Map(data.artists.map(a=>[a.uid,signature(a)])));}
  const empty=()=>({version:1,tags:['可爱','唯美','暗黑','酷炫','清爽','华丽'],artists:[]});
  async function json(dir,name){return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());}
  async function put(dir,name,value){const f=await dir.getFileHandle(name,{create:true}),s=await f.createWritable();try{await s.write(value);await s.close();}catch(e){try{await s.abort();}catch{}throw e;}}
  function validWork(w){return w&&((typeof w.file==='string'&&filePattern.test(w.file))||(typeof w.image==='string'&&/^(data:image\/(jpeg|png|webp|gif|avif);base64,[a-zA-Z0-9+/=\s]+|https:\/\/\S+)$/.test(w.image)));}
  async function read(dir){
    let index;try{index=await json(dir,'画师库.json');}catch(e){if(e.name!=='NotFoundError')throw e;for await(const entry of dir.values())throw Error('请选择现有「数据」文件夹，或一个空文件夹。');snapshots.set(dir,new Map());return empty();}
    if(index.version!==1||!Array.isArray(index.artists)||index.artists.length>20000||index.artists.some(id=>!valid(id)))throw Error('画师库索引格式错误');
    const data={...index,artists:new Array(index.artists.length)},records=new Map();
    if(index.artists.length){const artists=await dir.getDirectoryHandle('画师');let cursor=0;
      await Promise.all(Array.from({length:Math.min(8,index.artists.length)},async()=>{while(cursor<index.artists.length){const i=cursor++,id=index.artists[i],a=await json(await artists.getDirectoryHandle(id),'信息.json');if(a.uid!==id||!Array.isArray(a.works)||a.works.some(w=>!validWork(w)))throw Error('画师资料格式错误：'+id);data.artists[i]=a;records.set(id,signature(a));}}));
    }
    snapshots.set(dir,records);return data;
  }
  async function readImage(dir,id,file){
    if(!valid(id)||!filePattern.test(file))throw Error('图片路径错误');
    const a=await dir.getDirectoryHandle('画师'),f=await a.getDirectoryHandle(id),images=await f.getDirectoryHandle('预览图'),blob=await (await images.getFileHandle(file.slice(4))).getFile();
    if(blob.size>25*1024*1024)throw Error('图片超过 25 MB');return new Blob([blob],{type:'image/'+file.split('.').pop()});
  }
  async function exportTo(dir,data,stream,progress=()=>{}){
    const {artists,...header}=data;await stream.write(JSON.stringify(header).slice(0,-1)+',"artists":[');
    for(let i=0;i<artists.length;i++){const {works,...meta}=artists[i];progress(i+1,artists.length);await stream.write((i?',':'')+JSON.stringify(meta).slice(0,-1)+',"works":[');
      for(let j=0;j<works.length;j++){const copy={...works[j]};if(copy.file){const blob=await readImage(dir,meta.uid,copy.file),bytes=new Uint8Array(await blob.arrayBuffer());let s='';for(let k=0;k<bytes.length;k+=32768)s+=String.fromCharCode(...bytes.subarray(k,k+32768));copy.image='data:'+blob.type+';base64,'+btoa(s);delete copy.file;}await stream.write((j?',':'')+JSON.stringify(copy));}await stream.write(']}');
    }await stream.write(']}');
  }
  async function write(dir,data){
    if(data.version!==1||!Array.isArray(data.artists)||data.artists.length>20000)throw Error('画师库格式错误');
    const ids=new Set();for(const a of data.artists){if(!valid(a.uid)||ids.has(a.uid)||!Array.isArray(a.works))throw Error('画师标识格式错误');ids.add(a.uid);if(a.works.some(w=>!validWork(w)))throw Error('图片格式错误');}
    let previous=[];try{previous=(await json(dir,'画师库.json')).artists;}catch(e){if(e.name!=='NotFoundError')throw e;}
    const before=snapshots.get(dir)||new Map(),records=new Map(),artists=await dir.getDirectoryHandle('画师',{create:true}),result={...data,artists:[]},cleanup=[];
    for(const a of data.artists){
      const stamp=signature(a);if(before.get(a.uid)===stamp){records.set(a.uid,stamp);result.artists.push(a);continue;}
      const folder=await artists.getDirectoryHandle(a.uid,{create:true}),images=await folder.getDirectoryHandle('预览图',{create:true}),copy=structuredClone(a),used=new Set();
      for(const w of copy.works){
        if(w.file){delete w.image;used.add(w.file.slice(4));continue;}
        const m=w.image.match(/^data:image\/(jpeg|png|webp|gif|avif);base64,([a-zA-Z0-9+/=\s]+)$/);
        if(m){const bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));if(bytes.length>25*1024*1024)throw Error('图片超过 25 MB');const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,24),name=hash+'.'+m[1];await put(images,name,bytes);w.file='预览图/'+name;delete w.image;used.add(name);}
      }
      await put(folder,'信息.json',JSON.stringify(copy,null,2));records.set(a.uid,signature(copy));result.artists.push(copy);cleanup.push({images,used});
    }
    await put(dir,'画师库.json',JSON.stringify({...data,artists:[...ids]},null,2));snapshots.set(dir,records);
    for(const {images,used} of cleanup)try{for await(const entry of images.values())if(entry.kind==='file'&&/^[a-f0-9]{24}\.(jpeg|png|webp|gif|avif)$/.test(entry.name)&&!used.has(entry.name))await images.removeEntry(entry.name);}catch(error){warn('旧预览图清理失败（'+error.message+'）');}
    for(const id of previous)if(valid(id)&&!ids.has(id))try{await artists.removeEntry(id,{recursive:true});}catch(error){warn('画师 '+id+' 的目录删除失败（'+error.message+'）');}
    return result;
  }
  root.FolderStore={read,write,readImage,validWork,exportTo,remember,empty,takeWarnings};if(typeof module!=='undefined')module.exports=root.FolderStore;
})(globalThis);
