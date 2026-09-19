(function(root){
  'use strict';
  /* 记住上次用的数据文件夹：File System Access 的目录句柄可以结构化克隆后存进 IndexedDB，
     下次打开网页就能直接取回来用，不必再走一遍文件夹选择框。
     两个必须知道的边界：
     1) 句柄按「源」记：file:// 打开的那份与 chrome-extension:// 里的那份各记各的；
     2) 浏览器重启后权限通常退回 prompt，需要用户点一下（requestPermission）才能继续——
        这是浏览器的安全模型，网页/扩展都绕不过去；同一会话内刷新一般是直接可用。
     存不了（比如环境没有 IndexedDB）就静默失败，调用方照旧让用户手选。 */
  const DB_NAME='artist-library',DB_VERSION=1,STORE='handles',KEY='dataFolder';
  let injected=null;
  const factory=()=>injected||(typeof indexedDB!=='undefined'?indexedDB:null);
  const openDb=db=>new Promise((resolve,reject)=>{
    let request;
    try{request=db.open(DB_NAME,DB_VERSION);}catch(error){reject(error);return;}
    request.onupgradeneeded=()=>{try{request.result.createObjectStore(STORE);}catch{}};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('IndexedDB 打不开'));
  });
  const ask=request=>new Promise((resolve,reject)=>{
    if(!request){resolve(null);return;}
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('IndexedDB 读写失败'));
  });
  async function run(mode,fn){
    const db=factory();
    if(!db)throw Error('这个环境没有 IndexedDB');
    const handle=await openDb(db);
    try{return await ask(fn(handle.transaction(STORE,mode).objectStore(STORE)));}
    finally{try{handle.close();}catch{}}
  }
  const save=async folder=>{if(!folder)return false;try{await run('readwrite',store=>store.put(folder,KEY));return true;}catch{return false;}};
  const load=async()=>{try{return (await run('readonly',store=>store.get(KEY)))||null;}catch{return null;}};
  const forget=async()=>{try{await run('readwrite',store=>store.delete(KEY));return true;}catch{return false;}};
  /* 只给测试用：换掉 IndexedDB 实现（传 null 恢复默认）。 */
  const useFactory=value=>{injected=value||null;};
  root.ArtistFolderMemory={save,load,forget,useFactory,DB_NAME,STORE,KEY};
  if(typeof module!=='undefined')module.exports=root.ArtistFolderMemory;
})(globalThis);
