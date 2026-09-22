(() => {
  const cache=new ImageResources.ByteCache(),queue=new ImageResources.Queue(3),bindings=new Map(),failures=new Map(),revisions=new Map();let folder,epoch=0;
  /* 同一组缩略图连续就绪时排队进场：0、24、48…（封顶 11 档 = 264ms）。
     图像是异步就绪的，所以按「到达顺序」而不是格子序号排——谁先读到谁先冒出来，
     但每多一张就多等一档，"一张接一张"的节奏和 takoma 换页时一样。
     隔 350ms 以上没有新图，就当作新的一批从 0 重新排，滚动长列表时不会越拖越慢。 */
  const bursts=new Map();
  function cascadeDelay(group){
    const now=Date.now(),burst=bursts.get(group);
    if(!burst||now-burst.at>350){bursts.set(group,{at:now,count:1});return 0;}
    burst.at=now;return Math.min(burst.count++,11)*24;
  }
  const refOf=(w,size)=>{const ref=FolderStore.imageOf(w,size);if(!ref)throw Error(size==='large'?'这张作品没有可用的原图。':'这张作品没有可用的预览图。');return ref;};
  const key=(uid,w,size)=>{const ref=FolderStore.imageOf(w,size);if(!ref)return uid+':'+size+':none';return ref.kind==='local'?'local:'+epoch+':'+uid+':'+ref.path+':'+(revisions.get(uid+':'+ref.path)||0):uid+':'+size+':'+(ref.url||ref.data);};
  async function fetchBlob(uid,w,size,signal){
    const id=key(uid,w,size),hit=cache.get(id);if(hit)return hit;
    const failed=failures.get(id);if(failed&&Date.now()-failed.time<30000)throw Error(failed.message);
    const requestedFolder=folder,requestedEpoch=epoch;
    return queue.run(async()=>{const existing=cache.get(id);if(existing)return existing;try{
      const ref=refOf(w,size);let blob;
      if(ref.kind==='local'){if(!requestedFolder)throw Error('请先选择数据文件夹');blob=await FolderStore.readImage(requestedFolder,uid,ref.path);}
      else if(ref.kind==='inline')blob=FolderStore.blobOf(ref.data);
      else blob=await ArtistExtension.image(ref.url,signal);
      if(signal?.aborted)throw new DOMException('已取消','AbortError');
      if(requestedEpoch===epoch&&id===key(uid,w,size))cache.set(id,blob);return blob;
    }catch(error){if(error.name!=='AbortError')failures.set(id,{time:Date.now(),message:error.message});while(failures.size>100)failures.delete(failures.keys().next().value);throw error;}},signal);
  }
  function release(record){record.controller?.abort();record.controller=null;if(record.objectUrl)URL.revokeObjectURL(record.objectUrl);record.objectUrl=null;record.img.removeAttribute('src');}
  async function show(record){if(record.controller||record.objectUrl)return;const controller=new AbortController();record.controller=controller;record.img.classList.remove('image-failed');
    try{const blob=await fetchBlob(record.uid,record.work,record.size,controller.signal);if(record.controller!==controller||!bindings.has(record.img))return;
      // 加载过程中刚完成落盘时，把这份相同内容同步到本地路径缓存。
      if(record.persisted)cache.set(key(record.uid,record.work,record.size),blob);
      const img=record.img;
      record.objectUrl=URL.createObjectURL(blob);
      if(typeof Image==='function'){try{const decoder=new Image();decoder.src=record.objectUrl;await decoder.decode();}catch{}}
      if(record.controller!==controller||!bindings.has(img))return;
      const motion=()=>typeof matchMedia!=='function'||!matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(motion()&&img.src&&img.animate){
        const out=img.animate([{opacity:1},{opacity:0}],{duration:130,easing:'ease-in',fill:'forwards'});
        await out.finished.catch(()=>{});out.cancel();
        if(record.controller!==controller||!bindings.has(img))return;
      }
      img.src=record.objectUrl;img.title='';
      if(motion()){
        /* 缩略图逐张进场，和 takoma 换页时同一套观感：淡入 + 轻微上浮放大，同组内依次延迟。
           延迟必须配 fill:'backwards'——不然延迟期间元素按自然状态（不透明）显示，
           会先整张闪出来、再从头淡入。查看器里那张原图是单独一张，不做位移也不排队，
           保持干净的交叉淡入。 */
        if(record.size==='large')img.animate?.([{opacity:0},{opacity:1}],{duration:240,easing:'ease-out'});
        else img.animate?.([{opacity:0,transform:'translateY(10px) scale(.97)'},{opacity:1,transform:'none'}],{duration:260,easing:'cubic-bezier(.2,.9,.25,1)',delay:cascadeDelay(record.group),fill:'backwards'});
      }
    }
    catch(error){if(error.name!=='AbortError'&&record.controller===controller){record.img.classList.add('image-failed');record.img.title=error.message;record.img.alt='图片未加载：'+error.message;record.error?.(error);}}
  }
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){const r=bindings.get(entry.target);if(!r)continue;r.visible=entry.isIntersecting;if(r.visible)show(r);else release(r);}},{rootMargin:'300px'});
  function bind(img,uid,work,group,size='thumb',error){
    if(typeof size==='function'){error=size;size='thumb';}
    const existing=bindings.get(img),sourceKey=key(uid,work,size);
    /* 同一图片节点在卡片局部更新时会再次申请绑定；引用、分组、尺寸、来源都没变就保留
       Blob 与在途加载，不必重新取图。 */
    if(existing&&existing.uid===uid&&existing.group===group&&existing.size===size&&existing.sourceKey===sourceKey){
      existing.work=work;existing.error=error;
      /* 但**必须重新观察一次**（先撤再挂）。不相交状态没变时 IntersectionObserver 不会回调，
         而作品格是跨卡片复用节点的：占位被回收时它们会被逐张解绑（record 已删，走不到这里），
         卡片被工作池搬回来时又会重新 bind——如果这次恰好命中了上面的快路径，
         不重新观察就等于少了"再确认一次可见性"的机会，那张图可能一直停在有绑定、没 src。
         重新 observe 不会取消在途加载、也不会丢掉已经显示的图：
         show() 对已有 objectUrl 的记录本来就是空操作。 */
      observer.unobserve(img);observer.observe(img);
      return;
    }
    if(existing){observer.unobserve(img);existing.controller?.abort();if(existing.objectUrl)URL.revokeObjectURL(existing.objectUrl);bindings.delete(img);}
    const record={img,uid,work,group,size,error,sourceKey};bindings.set(img,record);img.decoding='async';img.onerror=()=>{if(record.objectUrl){img.classList.add('image-failed');img.title='图片内容无法解码';}};observer.observe(img);
  }
  // 仅由写盘成功的调用方传入同一作品的保存结果；更新引用而不撤销已显示的 Blob。
  function adoptPersisted(img,work){
    const record=bindings.get(img);if(!record)return false;
    const before=FolderStore.imageOf(record.work,record.size),after=FolderStore.imageOf(work,record.size);
    if(before?.kind!=='inline'||after?.kind!=='local')return false;
    const blob=cache.get(key(record.uid,record.work,record.size));
    record.work=work;record.persisted=true;record.sourceKey=key(record.uid,work,record.size);
    if(blob)cache.set(key(record.uid,work,record.size),blob);
    return true;
  }
  function invalidate(uid,path){
    const ref=uid+':'+path,version=revisions.get(ref)||0,id='local:'+epoch+':'+ref+':'+version;
    cache.delete(id);failures.delete(id);revisions.set(ref,version+1);
    for(const record of bindings.values())if(record.uid===uid&&FolderStore.imageOf(record.work,record.size)?.path===path){
      record.sourceKey=key(record.uid,record.work,record.size);
      release(record);if(record.visible)show(record);
    }
  }
  function unbind(img){const r=bindings.get(img);if(r){observer.unobserve(img);release(r);bindings.delete(img);}}
  /* 卡片离开文档时由画廊明确通报「这一整块不可见」，重新插回文档时再通报「可见」。
     不能指望 IntersectionObserver 兜底：元素被移出文档时它并不报「离开」，同一批 img
     被卡片复用、又插回文档时它也不会报「进入」，那几张图就永远停在「有绑定、没 src」的状态——
     用户看到的正是"取消书钉之后作品都没有被重新加载"：卡片回来了，图是空的。 */
  function announce(root,visible){
    if(!root)return;
    const nodes=[...(root.querySelectorAll?.('img')||[])];
    if(root.tagName==='IMG')nodes.push(root);
    for(const img of nodes){const record=bindings.get(img);if(!record)continue;record.visible=visible;if(visible)show(record);else release(record);}
  }
  function dispose(group){for(const [img,r] of bindings)if(r.group===group)unbind(img);bursts.delete(group);}
  function clear(){cache.clear();failures.clear();for(const r of bindings.values()){release(r);observer.unobserve(r.img);observer.observe(r.img);}}
  window.ArtistImages={bind,unbind,announce,adoptPersisted,dispose,fetch:fetchBlob,clear,invalidate,setFolder(value){for(const img of [...bindings.keys()])unbind(img);cache.clear();failures.clear();revisions.clear();bursts.clear();epoch++;folder=value;},stats(){return {bytes:cache.bytes,entries:cache.items.size,active:queue.active,queued:queue.waiting.length,bound:bindings.size};},async dataUrl(uid,w,size='thumb',signal){const blob=await fetchBlob(uid,w,size,signal);return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});}};
})();
