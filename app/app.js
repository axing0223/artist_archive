(() => {
  'use strict';
  const defaultCategories=['二次元','写实 / 半写实','Q版 / 卡通','概念 / 设定','场景 / 环境'];
  const defaults=['可爱','唯美','暗黑','酷炫','清爽','华丽'];
  /* 作品采集排序。收藏最多最贴近"多少人真的喜欢"；最新发布走编号索引，永远不会超时，
     其余三种依赖站点的排序元标签，而排序元标签没有索引，作品特别多的画师可能超时。 */
  const WORK_ORDERS=['favcount','score','id_desc'];
  const WORK_ORDER_LABELS={favcount:'收藏最多（热度）',score:'评分最高',id_desc:'最新发布'};
  const DEFAULT_WORK_ORDER='favcount';
  const WORK_ORDER_OPTIONS=WORK_ORDERS.map(value=>({value,label:WORK_ORDER_LABELS[value]}));
  const $=id=>document.getElementById(id), clone=v=>structuredClone(v);
  const uid=()=>'draft-'+(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2));
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const btn=(text,fn,cls='action')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
  const unique=a=>[...new Set(a.filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean))];
  const text=(v,max=5000)=>typeof v==='string'?v.slice(0,max):'';
  const url=v=>{try{const u=new URL(v);return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}};
  const link=(label,href,cls)=>{const a=el('a',cls,label);a.href=url(href);a.target='_blank';a.rel='noopener noreferrer';return a;};
  const imageValue=v=>typeof v==='string'&&(/^data:image\/(jpeg|png|webp|gif|avif);base64,/.test(v)||/^(?:缩略图|大图)\/(?:[a-f0-9]{24}|[^\u0000-\u001f\\/:*?"<>|][^\u0000-\u001f\\/:*?"<>|]{0,99}\.(?:jpeg|png|webp|gif|avif))$/.test(v))?v:null;
  const httpsValue=v=>typeof v==='string'&&v.startsWith('https://')?v:null;
  const seqOf=a=>ArtistId.parse(a.uid)?.seq??a.order;
  /* 卡片固定 5 格。开了「固定测试风格图」后最右 2 格归测试风格 1、2，作品图不能占用。 */
  const PREVIEW_SLOTS=5,RESERVED_SLOTS=2,UPLOAD_TYPES=['image/jpeg','image/png','image/webp','image/gif','image/avif'];
  const reservedOf=()=>data&&data.fixedTestSlots?RESERVED_SLOTS:0;
  const state={category:'全部',tags:new Set(),scores:new Set(),special:new Set(),query:'',sort:'order',desc:false};
  /* 特殊筛选：按「缺什么」找画师。键名会进筛选键与 aria，保持英文短横线。 */
  const SPECIAL_FILTERS=[['low-works','作品少于 50'],['no-test','没有测试风格图']];
  /* 「没读到」在数据里是 null 而不是缺字段，而 Number(null)===0：不能直接拿数字判断。 */
  const knownCount=value=>value!==null&&value!==undefined&&value!=='';
  /* 排序方向按钮：升序 ↑ / 降序 ↓，当前方向写在按钮自己身上。 */
  const paintSortDirection=()=>{const b=$('sort-direction');if(!b)return;swapIcon(b,state.desc?'↓':'↑');b.setAttribute('aria-pressed',String(state.desc));b.title=state.desc?'当前：降序（点击改为升序）':'当前：升序（点击改为降序）';};
  const libraryIndex=window.ArtistLibraryIndex.create();
  let filterSignature='',editorRevision=0;
  const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* 动效小工具：都先问一句「系统里关了动效吗」，关了就一个都不放。
     弹簧曲线与 style.css 里的 --ease-spring 是同一组数值，改一处要改两处。 */
  const SPRING='linear(0,.28 7%,.62 14%,.9 22%,1.04 31%,1.07 40%,1.04 50%,1 60%,.995 72%,1)';
  const canAnimate=node=>!reducedMotion()&&typeof node?.animate==='function';
  /* 数字变了弹一下（转场库的 number pop-in）：短、带一点模糊、不挪动布局。 */
  const popText=node=>{if(canAnimate(node))node.animate([{opacity:.35,filter:'blur(3px)',transform:'translateY(3px) scale(.96)'},{opacity:1,filter:'blur(0)',transform:'none'}],{duration:260,easing:'ease-out'});};
  /* 新出现的徽标从左上角斜着弹进来（转场库的 notification badge）。 */
  const popIn=node=>{if(canAnimate(node))node.animate([{opacity:0,transform:'translate(-4px,-4px) scale(.7)'},{opacity:1,transform:'none'}],{duration:320,easing:SPRING});};
  /* 校验失败抖一下，自己回到原位，不用清理内联样式（转场库的 error shake）。 */
  const shake=node=>{if(canAnimate(node))node.animate([{transform:'none'},{transform:'translateX(-5px)'},{transform:'translateX(5px)'},{transform:'translateX(-3px)'},{transform:'translateX(2px)'},{transform:'none'}],{duration:300,easing:'ease-in-out'});};
  /* 图标换成另一个字形时缩放淡入，而不是直接替换（转场库的 icon swap）。 */
  const swapIcon=(node,text)=>{if(!node||node.textContent===text)return;node.textContent=text;if(canAnimate(node))node.animate([{opacity:0,transform:'scale(.6)'},{opacity:1,transform:'none'}],{duration:200,easing:SPRING});};
  const PREF_KEY='artist-library.thumb-height',PREF_CARD='artist-library.card-size',PREF_CARD_COMPACT='artist-library.card-size-compact';
  const savePref=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};
  /* 两套视图各配各的预览高度：舒适视图读 --card-size，紧凑视图读 --card-size-compact。 */
  const applyCardSize=()=>{const style=document.documentElement.style;style.setProperty('--card-size',prefs.cardSize+'px');style.setProperty('--card-size-compact',prefs.cardSizeCompact+'px');};
  const prefs={thumbHeight:120,cardSize:190,cardSizeCompact:95,listeners:new Set(),
    setThumbHeight(value){this.thumbHeight=value;savePref(PREF_KEY,value);for(const fn of this.listeners)fn(value);},
    setCardSize(value){this.cardSize=value;savePref(PREF_CARD,value);applyCardSize();window.ArtistGallery?.remeasure?.();},
    /* 紧凑视图那条滑杆是独立的：改它不影响舒适视图，反之亦然。 */
    setCardSizeCompact(value){this.cardSizeCompact=value;savePref(PREF_CARD_COMPACT,value);applyCardSize();window.ArtistGallery?.remeasure?.();},
    subscribe(fn){this.listeners.add(fn);},unsubscribe(fn){this.listeners.delete(fn);}};
  try{
    const stored=Number(localStorage.getItem(PREF_KEY));if(Number.isFinite(stored)&&stored>=70&&stored<=220)prefs.thumbHeight=stored;
    const card=Number(localStorage.getItem(PREF_CARD));if(Number.isFinite(card)&&card>=140&&card<=360)prefs.cardSize=card;
    const compact=Number(localStorage.getItem(PREF_CARD_COMPACT));if(Number.isFinite(compact)&&compact>=60&&compact<=300)prefs.cardSizeCompact=compact;
  }catch{}
  let data,folder,draft,editingId,busy=false,uploading=false,volatile=false,generating=false,queueCount=null;
  /* 生图排队：一次只跑一条，两条之间隔 5±3 秒，避免一口气打过去被站点限流。
     排了长队就得能喊停，所以顶部有一个「排队 N · 清空」，只在真的有人排队时才出现。 */
  /* 批量排入期间不要每条都重画一次界面：几百条排队只是在同一个任务里跑完的，中间那些渲染没人看得见。 */
  let enqueueBulk=false;
  const genQueue=ArtistGenerateQueue.create({gap:()=>ArtistImageGen.genGapDelay(),onChange:()=>{paintQueue();/* 队列状态变了，格子上的「正在生成／排队中」要跟着走 */if(!enqueueBulk&&!busy&&data)render();}});
  function paintQueue(){
    const node=$('gen-queue'),count=genQueue.pending;
    /* 排队数变了就轻轻弹一下，让「已经排上了」有个交代。 */
    if(count!==queueCount){queueCount=count;if(!reducedMotion()&&typeof node.animate==='function')node.animate([{transform:'scale(.86)'},{transform:'scale(1)'}],{duration:220,easing:'ease-out'});}
    node.hidden=count===0;
    node.textContent=count?`排队 ${count} · 清空`:'排队 0';
    if(data)paintTasks();
    node.title=count?`还有 ${count} 条生成需求在排队，点一下全部取消（正在跑的那条会跑完）`:'';
  }
  function normalize(raw,backup=false){
    if(!raw||!Array.isArray(raw.artists)||(backup&&raw.version!==1))throw Error('不是此网页导出的备份。');
    if(raw.artists.length>20000)throw Error('最多支持 20,000 位画师。');
    const names=new Set(),ids=new Set(),issued=[];
    const categoryList=unique(Array.isArray(raw.categories)?raw.categories:defaultCategories).map(c=>c.slice(0,40));
    const artists=raw.artists.map((a,i)=>{
      if(!a||typeof a.name!=='string'||!a.name.trim()||!Array.isArray(a.works))throw Error(`第 ${i+1} 位画师数据不完整。`);
      const name=a.name.trim().slice(0,160),key=name.toLowerCase();if(names.has(key))throw Error('重复画师：'+name);names.add(key);
      if(a.category&&!categoryList.includes(a.category))throw Error('不支持的主分类：'+a.category);
      const danbooruId=Number.isSafeInteger(a.danbooruId)&&a.danbooruId>0?a.danbooruId:null,stored=text(a.uid,100);
      const id=ArtistId.valid(stored)&&!ids.has(stored)?stored:ArtistId.issue(issued,{name,danbooruId});
      ids.add(id);issued.push({uid:id});
      const works=a.works.map(w=>{if(!FolderStore.validWork(w))throw Error(name+' 的图片格式或本地路径无效。');return {id:text(String(w.id??''),100),url:url(w.url),caption:text(w.caption),thumb:imageValue(w.thumb),thumbUrl:httpsValue(w.thumbUrl),previewUrl:httpsValue(w.previewUrl),large:imageValue(w.large),largeUrl:httpsValue(w.largeUrl),...(w.kind==='test'?{kind:'test',testSeq:Number.isSafeInteger(w.testSeq)&&w.testSeq>0?w.testSeq:1}:{})};});
      const c=a.counts||{},number=n=>Number.isSafeInteger(n)&&n>=0?n:null;
      return {uid:id,order:i+1,name,category:a.category||null,score:Number.isSafeInteger(a.score)&&a.score>=1&&a.score<=5?a.score:null,aliases:unique(Array.isArray(a.aliases)?a.aliases:[]).map(x=>x.slice(0,60)),alias:typeof a.alias==='string'&&a.alias.trim()?a.alias.trim().slice(0,60):null,tags:unique(a.tags||[]).map(t=>t.slice(0,40)),danbooruId,counts:{total:number(c.total),checkedAt:text(c.checkedAt,40),beforeDate:text(c.beforeDate,10),beforeTotal:number(c.beforeTotal)},artistUrl:url(a.artistUrl),description:text(a.description),note:text(a.note),basis:text(a.basis,100),status:text(a.status,100),works};
    });
    return {version:1,categories:categoryList,cutoffDate:/^\d{4}-\d{2}-\d{2}$/.test(raw.cutoffDate)?raw.cutoffDate:'2026-07-01',saveLargeImages:raw.saveLargeImages===true,autoOpenWorks:raw.autoOpenWorks===true,fixedTestSlots:raw.fixedTestSlots===true,workOrder:WORK_ORDERS.includes(raw.workOrder)?raw.workOrder:DEFAULT_WORK_ORDER,date:text(raw.date,40),method:text(raw.method,12000),tags:unique([...(Array.isArray(raw.tags)?raw.tags:defaults),...artists.flatMap(a=>a.tags)]).map(t=>t.slice(0,40)),artists};
  }
  /* 文案真的变了才轻轻淡一下：保存、生图、检测都会写状态栏，一直闪反而吵。 */
  function status(t,error=false){
    const node=$('storage-status');
    if(!reducedMotion()&&node.textContent!==t&&typeof node.animate==='function')node.animate([{opacity:.25,filter:'blur(2px)',transform:'translateY(2px)'},{opacity:1,filter:'blur(0)',transform:'none'}],{duration:220,easing:'ease-out'});
    node.textContent=t;node.classList.toggle('error',error);node.title=t;
    window.ArtistWorkspace?.status(t,error);if(data)paintTasks();
  }
  /* 复制到剪贴板。file:// 下 clipboard API 通常可用，失败时退回选中文本再 execCommand 的老办法。 */
  async function copyText(text,what){
    try{await navigator.clipboard.writeText(text);status('已复制'+what+'：'+text);return;}catch{}
    try{
      const box=document.createElement('textarea');box.value=text;box.setAttribute('readonly','');
      box.style.position='fixed';box.style.top='-1000px';document.body.append(box);box.select();
      const ok=document.execCommand('copy');box.remove();
      status(ok?'已复制'+what+'：'+text:'复制失败，请手动选中复制。',!ok);
    }catch{status('复制失败，请手动选中复制。',true);}
  }
  async function write(value,targetFolder=folder){
    if(!targetFolder)throw Error('请先选择数据文件夹');
    const saved=await FolderStore.write(targetFolder,value);
    const normalized=normalize(saved),persisted=new Map(),byArtist=new Map();
    // 真正覆盖了同路径文件仍需使旧缓存失效；新预览则沿用已经显示的相同内容。
    for(let i=0;i<value.artists.length;i++)for(let j=0;j<value.artists[i].works.length;j++){
      const before=value.artists[i].works[j],artist=normalized.artists[i],work=artist.works[j];
      for(const kind of FolderStore.IMAGE_KINDS)if(before[kind]?.startsWith('data:'))ArtistImages.invalidate?.(artist.uid,work[kind]);
      if(before.thumb?.startsWith('data:')){
        const entry={before,artist,work};persisted.set(before,entry);
        const entries=byArtist.get(artist.uid)||[];entries.push(entry);byArtist.set(artist.uid,entries);
      }
    }
    if(persisted.size)for(const figure of document.querySelectorAll('#gallery .work[data-work]')){
      const record=workRecords.get(figure);if(!record)continue;
      // 失败后重试或排队保存可能克隆数据，但卡片指纹未变，仍持有上一份等值对象。
      const next=persisted.get(record.work)||(byArtist.get(record.artist.uid)||[]).find(({before})=>
        Object.keys(before).length===Object.keys(record.work).length&&Object.keys(before).every(key=>before[key]===record.work[key]));
      if(next&&ArtistImages.adoptPersisted(record.img,next.work)){
        record.artist=next.artist;record.work=next.work;record.stamp=workStamp(next.artist,next.work);
      }
    }
    return normalized;
  }
  /* 真正把一个目录句柄接上：不管是刚选的还是从记忆里取回来的，都走这里。 */
  async function adoptFolder(chosen,{from='刚选择',remember=true}={}){
    status('正在读取画师资料（图片按需加载）…');
    const loaded=normalize(await FolderStore.read(chosen),true);
    cancelLookup();clearCandidates();
    folder=chosen;data=loaded;FolderStore.remember(chosen,loaded);ArtistImages.setFolder(chosen);
    /* 换了文件夹就是另一批卡片：告诉画廊把旧占位全忘掉，别把上一位画师的卡片接着用。 */
    ArtistGallery.clear();
    reset();render();
    document.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=false);
    $('folder-name').textContent='当前文件夹：'+folder.name;
    $('resume-folder').hidden=true;
    /* 记住这个文件夹，下次打开网页直接接着用；记不住（环境不支持）就如实说一声。 */
    const kept=remember?await ArtistFolderMemory.save(chosen):true;
    const warnings=FolderStore.takeWarnings(),tail=kept?'':'；这个环境记不住文件夹，下次还得重新选';
    status(warnings.length?`已连接文件夹（${from}），但有 ${warnings.length} 处问题：${warnings.join('；')}${tail}`:`已连接文件夹（${from}） · 图片滚动到附近才加载${tail}`,warnings.length>0);
    /* 文件夹一就绪，就把右键菜单排队等着的那张卡建出来 */
    pumpCreate();  }
  async function connectFolder(){
    if(busy)return;
    if(generating||syncingAll||batchRunning||uploading||!genQueue.idle){status('请等当前采集、刷新或生成任务结束后再切换数据文件夹。',true);return;}
    if(!window.showDirectoryPicker){status('当前浏览器不支持文件夹读写，请使用最新版 Chrome 或 Edge 打开本 HTML。',true);return;}
    if(volatile){status('请先导出备份保留尚未保存的修改，再重新打开网页切换文件夹。',true);return;}
    try{await adoptFolder(await window.showDirectoryPicker({id:'artist-library',mode:'readwrite'}));}
    catch(error){if(error.name!=='AbortError')status('文件夹打开失败：'+error.message,true);}
  }
  /* 打开网页时把上次用的文件夹取回来：同一会话内通常直接可用；
     浏览器重启后权限会退回 prompt，这时给一个按钮，点一下就能继续（浏览器的安全模型，绕不过去）。 */
  async function restoreFolder(){
    if(folder)return;
    const handle=await ArtistFolderMemory.load();
    if(!handle)return;
    let permission='prompt';
    try{permission=await handle.queryPermission({mode:'readwrite'});}catch{}
    if(permission==='granted'){
      try{await adoptFolder(handle,{from:'上次的文件夹',remember:false});}
      catch(error){status('上次的数据文件夹打不开：'+error.message+'；请点顶部的文件夹按钮重新选择。',true);}
      return;
    }
    if(permission!=='prompt'){$('resume-folder').hidden=true;await ArtistFolderMemory.forget();return;}
    const name=handle.name||'数据',button=$('resume-folder');
    button.hidden=false;button.textContent=`继续使用上次的文件夹「${name}」`;
    button.onclick=async()=>{
      button.disabled=true;
      try{
        const granted=await handle.requestPermission({mode:'readwrite'});
        if(granted==='granted')await adoptFolder(handle,{from:'上次的文件夹',remember:false});
        else{await ArtistFolderMemory.forget();button.hidden=true;status('没有继续使用上次的文件夹，请点顶部的文件夹按钮重新选择。',true);}
      }catch(error){button.hidden=true;status('继续使用上次的文件夹失败：'+error.message+'；请重新选择。',true);}
      finally{button.disabled=false;}
    };
    status(`记得你上次用的是「${name}」：点「继续使用上次的文件夹」，或点顶部的文件夹按钮换一个。`);
  }
  // 所有落盘串行执行。异步任务传入更新函数，在轮到自己时合并最新数据。
  let saveTail=Promise.resolve(),pendingSaves=0;
  /* 「添加一位画师」要先取图、再查数量，最后才落盘；这段等待里 data 会被别的操作改掉。
     所以这类添加排队串行，各自轮到自己时才取最新数据、发序号——不能各自克隆整库快照。 */
  let addArtistTail=Promise.resolve();
  const saveControls=new Map();
  function lockSaveControls(){
    // 惰性挂载的卡片也不可在写盘中再次修改；inert 不阻止页面滚动。
    $('gallery').inert=true;
    for(const node of document.querySelectorAll('button,input,textarea,select')){
      if(!saveControls.has(node))saveControls.set(node,node.disabled);
      if(!saveControls.get(node))node.classList.add('is-saving-locked');
      node.disabled=true;
    }
  }
  /* 业务校验拒绝（重名、目标已被删除…）与真正的写盘失败是两回事，不能混成一个 catch。 */
  const reject=message=>Object.assign(Error(message),{validation:true});
  // onApplied 在数据校验合并后呈现本次操作，界面无需等待文件系统往返。
  function save(next,message='已保存到数据文件夹',onApplied){
    const targetFolder=folder;
    if(pendingSaves++===0){
      busy=true;
      lockSaveControls();
    }
    const operation=saveTail.then(async()=>{
      try{
        if(targetFolder!==folder)throw Error('数据文件夹已经切换，未写入旧任务');
        data=typeof next==='function'?next(clone(data)):next;
        status('正在保存…');if(onApplied)onApplied();else render();data=await write(data,targetFolder);volatile=false;
        const warnings=FolderStore.takeWarnings(),label=typeof message==='function'?message():message;status(warnings.length?label+'；'+warnings.join('；'):label,warnings.length>0);
        return true;
      }catch(error){
        /* 校验类拒绝不是写盘失败：数据没丢，不该让用户去导出备份，更不该锁住切换文件夹。 */
        if(error?.validation){status(error.message,true);return false;}
        volatile=true;status('文件保存失败：'+error.message+'；修改暂留本页，请导出备份。',true);return false;
      }
      finally{
        if(--pendingSaves===0){saveControls.forEach((disabled,node)=>{node.disabled=disabled;node.classList.remove('is-saving-locked');});saveControls.clear();$('gallery').inert=false;busy=false;}
        render();
      }
    });
    saveTail=operation.catch(()=>{});return operation;
  }
  function reset(){state.category='全部';state.tags.clear();state.scores.clear();state.special.clear();state.query='';$('search').value='';}
  /* 只有拿到正式标识的画师才谈得上「保存原图」：草稿态放行会在数据目录里写下一个
     没人认领的 draft- 目录（不在索引里，扫描与清理都够不到）。 */
  function showImage(a,w){const items=a.works?FolderStore.previewWorks(a,PREVIEW_SLOTS,reservedOf()).filter(Boolean):(draft?.uid===a.uid?draft.works:null);ArtistViewer.open({title:a.name,uid:a.uid,work:w,caption:w.caption,persist:ArtistId.parse(a.uid)!==null,items});}
  /* 一格作品的稳定编号：重画之后靠它认出「还是这一格」，好让它滑到新位置而不是跳过去。
     既没有作品编号也没有来源链接的，只能拿它在列表里的位置凑合（这种一格本来也没什么可对的）。 */
  const workKey=(uid,w,slot)=>uid+':'+(w.kind==='test'?`test${w.testSeq||1}`:(w.id||w.url||'i'+slot));
  /* 删掉/加进一格作品之后，同一张卡片里没被动的格子应该滑到新位置。
     用法：动数据之前取一次位置，重画之后再结算。 */
  function rememberWorkSlots(uid=draft?.uid){
    const scope=uid?document.querySelector('.artist-slot[data-uid="'+uid+'"]'):$('gallery');
    const figures=()=>scope?.querySelectorAll?.('.work[data-work]')||[];
    const before=new Map();
    for(const figure of figures())before.set(figure.dataset.work,figure.getBoundingClientRect());
    return ()=>{
      if(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      for(const figure of figures()){
        const was=before.get(figure.dataset.work);
        if(!was||typeof figure.animate!=='function')continue;
        const now=figure.getBoundingClientRect(),dx=was.left-now.left,dy=was.top-now.top;
        if(Math.abs(dx)<1&&Math.abs(dy)<1)continue;
        figure.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],{duration:220,easing:'cubic-bezier(.22,.61,.36,1)'});
      }
    };
  }
  const workRecords=new WeakMap();
  // 移除失效节点后只插入/移动变化项；未改的图片不离开原来的作品区。
  function reconcileNodes(parent,nodes){
    const wanted=new Set(nodes);
    for(const node of [...parent.children])if(!wanted.has(node))node.remove();
    nodes.forEach((node,i)=>{if(parent.children[i]!==node)parent.insertBefore(node,parent.children[i]||null);});
  }
  const workStamp=(a,w)=>JSON.stringify([a.uid,w.id||'',w.kind||'',w.testSeq||0,FolderStore.imageOf(w,'thumb')]);
  function workFigure(a,w,slot,editing=false){
    const figure=el('figure','work'),img=el('img'),caption=el('figcaption');
    const record={artist:a,work:w,index:slot,editing,img,caption,stamp:workStamp(a,w)};workRecords.set(figure,record);
    const open=btn('',()=>showImage(record.editing?{uid:record.artist.uid,name:record.artist.name}:record.artist,record.work),'thumb');record.open=open;
    const remove=editing?btn('移除',()=>{
      if(draft!==record.artist)return;const index=draft.works.indexOf(record.work);if(index<0)return;
      const settle=rememberWorkSlots(draft.uid);draft.works.splice(index,1);paintEditorWorks();markEditorPainted();settle();
    },'danger-link'):confirmButton('删除','再点一次删除',()=>deleteSlotWork(record.artist,record.work),'slot-delete');
    record.remove=remove;ArtistImages.bind(img,a.uid,w,editing?'editor':'card:'+a.uid,'thumb');open.append(img);figure.append(open,caption);
    updateWorkFigure(figure,a,w,slot);return figure;
  }
  function updateWorkFigure(figure,a,w,slot){
    const record=workRecords.get(figure);Object.assign(record,{artist:a,work:w,index:slot});
    figure.dataset.work=workKey(a.uid,w,slot);figure.classList.toggle('is-test',w.kind==='test');
    record.open.setAttribute('aria-label',record.editing?'预览 '+a.name+' 的图片 '+(slot+1):`查看 ${a.name} 的${w.kind==='test'?'测试风格图片 '+(w.testSeq||1):'作品 '+(slot+1)}`);
    record.img.alt=a.name+' 的'+(w.kind==='test'?'测试风格 '+(w.testSeq||1):'作品 '+(slot+1));
    record.caption.replaceChildren(record.editing?el('span','',w.kind==='test'?`测试风格 ${w.testSeq||1}`:'作品 '+(slot+1)):slotLabel(a,w,slot),record.remove);
  }
  function workPool(container){
    const pool=new Map();for(const node of container.children){const record=workRecords.get(node);if(!record)continue;const bucket=pool.get(record.stamp)||[];bucket.push(node);pool.set(record.stamp,bucket);}return pool;
  }
  function takeWork(pool,a,w,i,editing=false){
    const kept=pool.get(workStamp(a,w))?.shift();if(kept){updateWorkFigure(kept,a,w,i);return kept;}return workFigure(a,w,i,editing);
  }
  function reconcileWorks(container,nodes){
    const wanted=new Set(nodes);for(const node of container.children){const record=workRecords.get(node);if(record&&!wanted.has(node))ArtistImages.unbind(record.img);}
    reconcileNodes(container,nodes);
  }
  /* 左下角：有 Danbooru 编号就做成可点的 #编号，点开对应作品页；测试风格图只写序号，不给链接。 */
  function slotLabel(a,w,slot){
    if(w.kind==='test')return el('span','',`测试风格 ${w.testSeq||1}`);
    const id=String(w.id||'').trim(),href=url(w.url)||(id?`https://danbooru.donmai.us/posts/${encodeURIComponent(id)}`:'');
    if(id&&href){const node=link('#'+id,href,'work-id');node.title='在 Danbooru 打开这件作品';return node;}
    if(href)return link('来源 ↗',href,'work-id');
    return el('span','',w.id?'#'+w.id:'作品 '+(slot+1));
  }
  async function deleteSlotWork(a,w){
    const index=Array.isArray(a.works)?a.works.indexOf(w):-1;
    if(index<0){status('这一格已经不在库里了。',true);return;}
    const isTest=w.kind==='test',what=isTest?`测试风格 ${w.testSeq||1}`:`作品 #${w.id||index+1}`;
    const next=clone(data),target=next.artists.find(item=>item.uid===a.uid);
    if(!target||!target.works[index]){status('这一格已经不在库里了。',true);return;}
    target.works.splice(index,1);
    const settle=rememberWorkSlots(a.uid);
    await save(next,`已删除「${a.name}」的${what}`,()=>{render();settle();});
  }
  /* 外部拖图进来：落到哪一格就换成哪一格（测试格按该格的序号，作品格换掉那一格）。 */
  function attachDrop(node,a,index){
    const mark=on=>node.classList.toggle('is-drop-target',on);
    node.addEventListener('dragover',event=>{if(!event.dataTransfer)return;event.preventDefault();event.dataTransfer.dropEffect='copy';mark(true);});
    node.addEventListener('dragleave',()=>mark(false));
    node.addEventListener('drop',event=>{mark(false);const files=[...(event.dataTransfer?.files||[])];if(!files.length)return;event.preventDefault();const current=workRecords.get(node);dropImages(current?.artist||a,current?.index??index,files);});
  }
  async function dropImages(a,index,files){
    if(busy||uploading||generating)return;
    if(!folder){status('请先选择「数据」文件夹，拖进来的图片要有地方保存。',true);return;}
    uploading=true;status(`正在处理拖进来的 ${files.length} 张图片…`);
    try{
      const added=[],skipped=[];
      for(const file of files){
        if(!UPLOAD_TYPES.includes(file.type)||file.size>FolderStore.MAX_IMAGE_BYTES){skipped.push(file.name||'未命名');continue;}
        const original=await readImage(file);
        added.push({id:'',url:'',caption:'',thumb:await thumbnail(original),large:original,thumbUrl:null,largeUrl:null});
      }
      if(!added.length)throw Error('拖进来的不是支持的图片（只收 JPG、PNG、WebP、GIF、AVIF，单张不超过 50 MB）。');
      const settle=rememberWorkSlots(a.uid);
      await save(next=>{
        const target=next.artists.find(item=>item.uid===a.uid);
        if(!target)throw Error('这位画师已经不在库里了。');
        target.works=FolderStore.placeWork(target,index,added,{limit:PREVIEW_SLOTS,reserve:reservedOf()});
        return next;
      },`已把 ${added.length} 张图片放进「${a.name}」从第 ${index+1} 格起的位置${skipped.length?`；跳过 ${skipped.length} 个不支持的文件：${skipped.slice(0,3).join('、')}`:''}`,()=>{render();settle();});
    }catch(error){status('拖入失败：'+error.message,true);}
    finally{uploading=false;}
  }
  /* 空着的固定格：一个「生成」按钮，外加它对应的测试风格序号。
     按钮自己承担二次确认（第一次点亮、第二次才真发），不再弹系统对话框。
     格子长什么样由队列决定：卡片因为保存被重建时，正在生成/排队的格子也要照旧显示对应状态。 */
  function generateSlot(a,seq){
    const box=el('div','work work-generate'),label=el('span','generate-seq','测试风格 '+seq),button=btn('生成',()=>armGenerate(a,seq,{box,button,label}),'generate-button');
    button.title=`用 NovelAI 生成「测试风格 ${seq}」并回填到这一格`;
    box.append(button,label);
    const active=genQueue.current;
    if(active&&active.uid===a.uid&&active.seq===seq)generatingMark(box,genQueue.waiting?'间隔等待中，马上开始…':'正在请求 NovelAI…');
    else{const place=genQueue.positionOf(item=>item.uid===a.uid&&item.seq===seq);if(place)queuedMark(box,place);}
    return box;
  }
  let armedSlot=null,armedTimer=null;
  function disarmSlot(){
    clearTimeout(armedTimer);armedTimer=null;
    if(!armedSlot)return;
    const {box,button,label,text}=armedSlot;
    button.textContent='生成';button.classList.remove('is-armed');box.classList.remove('is-armed');
    label.textContent=text;armedSlot=null;
  }
  function armGenerate(a,seq,slot){
    if(busy)return;
    if(armedSlot&&armedSlot.button===slot.button){disarmSlot();enqueueGenerate(a,seq,slot);return;}
    disarmSlot();
    armedSlot={...slot,text:slot.label.textContent};
    slot.button.textContent='再点一次开始';slot.button.classList.add('is-armed');slot.box.classList.add('is-armed');
    slot.label.textContent='会消耗额度或点数';
    armedTimer=setTimeout(disarmSlot,5000);
  }
  /* 生成期间的过渡动画：格子里换成转动的环与一行进度文字，按钮置灰。 */
  const progressOf=box=>[...box.children].find(child=>String(child.className).includes('gen-progress'));
  /* 卡片可能已经被重新渲染过，旧节点就是脱落的：脱落的节点不再去动它。 */
  const liveBox=box=>box&&box.isConnected!==false?box:null;
  function generatingMark(box,text){
    box.classList.add('is-generating');
    box.replaceChildren(el('span','gen-spinner'),el('span','gen-progress',text));
  }
  function queuedMark(box,place){
    if(!box)return;
    box.classList.add('is-queued');
    const button=[...box.children].find(child=>String(child.className).includes('generate-button'));
    if(button){button.textContent='排队中 '+place;button.disabled=true;}
    const label=[...box.children].find(child=>String(child.className).includes('generate-seq'));
    if(label)label.textContent='等前面那条跑完';
  }
  function unqueuedMark(box){
    if(!box)return;
    box.classList.remove('is-queued');
    const button=[...box.children].find(child=>String(child.className).includes('generate-button'));
    if(button){button.disabled=false;button.textContent='生成';}
  }
  /* 排队：一次只跑一条，两条之间隔 5±3 秒。第二条起都是先入队再等，第一条立刻发。
     批量排入时用 quiet：几百条挨个写状态栏只是白费，最后由调用方给一句总结。 */
  function enqueueGenerate(a,seq,slot,quiet=false){
    if(busy||!a)return false;
    if(!folder){if(!quiet)disarmSlot();status('请先选择「数据」文件夹，生成出来的图片要有地方保存。',true);return false;}
    const uid=a.uid;
    if(genQueue.has(item=>item.uid===uid&&item.seq===seq)){if(!quiet)status(`「${a.name}」的测试风格 ${seq} 已经在排队了。`,true);return false;}
    const box=liveBox(slot?.box);
    queuedMark(box,genQueue.pending+1);
    const place=genQueue.push({
      uid,seq,
      run:()=>runGenerateJob({uid,seq,box}),
      onError:error=>status('生成失败：'+error.message,true),
    });
    if(place>1&&!quiet)status(`已排入队列：第 ${place} 位，「${a.name}」测试风格 ${seq}。`);
    return true;
  }
  async function runGenerateJob({uid,seq,box}){
    box=liveBox(box);
    const target=data.artists.find(item=>item.uid===uid);
    if(!target){unqueuedMark(box);status('这位画师已经不在库里了，这一条跳过。',true);return;}
    const name=target.name,previous=box?[...box.children]:null;
    if(box)generatingMark(box,'正在请求 NovelAI…');
    generating=true;status(`正在向 NovelAI 请求「${name}」的测试风格 ${seq}…`);
    try{
      const before=ArtistImageGen.cachedAccount();
      const {blob,prompt,free,width,height,steps}=await ArtistImageGen.generate(target,seq);
      const progress=box&&progressOf(box);
      if(progress)progress.textContent='正在保存到画师目录…';
      const original=await readImage(blob),thumb=await thumbnail(original);
      let testSeq;
      const saved=await save(next=>{
        const into=next.artists.find(item=>item.uid===uid);
        if(!into)throw Error('这位画师已经不在库里了，图片没有保存。');
        testSeq=FolderStore.nextTestSeq(into.works,seq);
        into.works.push({id:'',url:'',caption:prompt,kind:'test',testSeq,thumb,large:original,thumbUrl:null,largeUrl:null});
        return next;
      },()=>`已为「${name}」生成测试风格 ${testSeq}（${width} × ${height} · ${steps} 步${free?' · 未用点数':''}）`);
      if(!saved)return;
      const after=await refreshAccount(true);
      if(after&&before&&!free&&after.anlas<before.anlas)status(`已生成测试风格 ${testSeq}；这次消耗了 ${before.anlas-after.anlas} 点 Anlas，剩余 ${after.anlas} 点。`);
    }catch(error){
      status('生成失败：'+error.message,true);
      if(box){box.classList.remove('is-generating');box.replaceChildren(...previous);unqueuedMark(box);}
    }finally{generating=false;}
  }
  function chooseSlotImage(a,index){
    const input=el('input');input.type='file';input.accept=UPLOAD_TYPES.join(',');input.multiple=true;
    input.onchange=()=>{const files=[...input.files];if(files.length)dropImages(a,index,files);};input.click();
  }
  function artistCard(a,previous){
    const article=previous||el('article','artist'),info=el('div','artist-info'),identity=el('div','artist-identity'),row=el('div','name-row');
    article.dataset.artist=a.name;article.setAttribute('aria-label','画师 '+a.name);
    const heading=el('h2'),name=btn(a.name,()=>copyText(a.name,'画师 tag'),'artist-name');name.title='点击复制画师 tag';name.setAttribute('aria-label','复制画师 tag：'+a.name);heading.append(name);
    row.append(el('span','serial',String(seqOf(a)).padStart(4,'0')),heading);
    if(collectingUid===a.uid){const badge=el('span','artist-collecting','采集中');if(!previous?.querySelector?.('.artist-collecting'))popIn(badge);row.append(badge);}
    if(a.alias)row.append(el('span','alias',a.alias));
    /* 站点作品少于 50 的整项标红：这一档基本等于刚起步或快清号了，值得一眼从一屏卡片里挑出来。
       注意「没读到」在数据里是 null 而不是缺字段——Number(null)===0，写成数字判断会把没读到的当成 0。 */
    const siteTotal=a.counts?.total,lowWorks=knownCount(siteTotal)&&Number(siteTotal)<50;
    /* 两套视图共用一套说法：「作品数量：最新数量（截至日期数量）」，和《使用说明》里那句一致。
       括号里是截至日期之前有多少——并排才看得出涨了多少；没读到就整个省略括号。
       括号外那个数才是「少于 50 标红」的判定对象。 */
    const count=el('span','artist-site-count'+(lowWorks?' is-low':''),'作品数量：'+(siteTotal??'未读取'));
    if(knownCount(a.counts?.beforeTotal))count.append(el('span','artist-before-inline','（'+a.counts.beforeTotal+'）'));
    count.title='本库收录 '+a.works.length+' 张；截至日期：'+(a.counts?.beforeDate||data.cutoffDate);
    row.append(count);
    /* 只有数字真的变了才弹——每次重画都弹就成了噪音。 */
    const oldCount=previous?.querySelector?.('.artist-site-count');
    if(oldCount&&oldCount.textContent!==count.textContent)popText(count);
    const meta=el('div','artist-meta');meta.append(el('span',a.category?'primary':'pending-badge',a.category||'待判断'));
    if(a.tags.length){const tags=el('div','secondary');a.tags.forEach(t=>tags.append(el('span','',t)));meta.append(tags);}
    if(previous)for(const node of [...article.children])if(node.className.startsWith('score-badge'))node.remove();
    if(Number.isSafeInteger(a.score)&&a.score>=1&&a.score<=5){const score=el('span','score-badge score-'+a.score,String(a.score));score.setAttribute('aria-label','参考评分 '+a.score+' 分');score.title='参考评分 '+a.score+' / 5';article.append(score);}
    row.append(meta);identity.append(row);
    const actions=el('div','artist-actions');actions.append(deleteArtistButton(a));
    if(a.artistUrl){const source=link('画师页面',a.artistUrl,'edit-button');source.setAttribute('aria-label','打开 '+a.name+' 的画师页面');actions.append(source);}
    else{const source=btn('画师页面',()=>{},'edit-button');source.disabled=true;source.title='尚未填写画师页面';actions.append(source);}
    actions.append(btn('编辑',()=>startEdit(a),'edit-button'));info.append(identity,actions);
    const works=previous?[...previous.children].find(node=>node.className==='works'):el('div','works'),pool=workPool(works),reserve=reservedOf(),slots=FolderStore.previewWorks(a,PREVIEW_SLOTS,reserve);
    const workNodes=slots.map((w,i)=>{const reused=w&&pool.get(workStamp(a,w))?.length;const node=w?takeWork(pool,a,w,i):i>=PREVIEW_SLOTS-reserve?generateSlot(a,PREVIEW_SLOTS-i):btn('添加图片',()=>chooseSlotImage(a,i),'work work-empty');
      if(!w&&i<PREVIEW_SLOTS-reserve){node.setAttribute('aria-label','为 '+a.name+' 的第 '+(i+1)+' 格添加图片');node.title='选择图片或拖入此格';}if(!reused)attachDrop(node,a,i);return node;
    });
    reconcileWorks(works,workNodes);
    const footer=el('div','artist-footer');
    if(a.description||a.note||a.basis){const notes=el('details','artist-notes');notes.append(el('summary','','画风与备注'));if(a.description)notes.append(el('p','description',a.description));if(a.note)notes.append(el('p','sample-note',a.note));if(a.basis)notes.append(el('p','basis',a.basis));footer.append(notes);}
    const oldNotes=previous?.querySelector?.('.artist-notes'),notes=footer.querySelector?.('.artist-notes');if(oldNotes&&notes)notes.open=oldNotes.open;
    const badge=[...article.children].find(node=>node.className.startsWith('score-badge'));
    reconcileNodes(article,[...(badge?[badge]:[]),info,works,footer]);return article;
  }
  /* 认草稿有两种情况：新建时 rows 里放的就是 draft 本身；编辑已有画师时按 editingId 认，
     不能按 draft.uid——刷新同步到正式名之后 draft.uid 会和库里存的那条不一样。 */
  function patchCard(node,a){
    if(!node||node.classList.contains('is-editing')||(draft&&(a===draft||a.uid===editingId)))return false;
    artistCard(a,node);return true;
  }
  function card(a){return draft&&(a===draft||(editingId&&a.uid===editingId))?editingCard(a):artistCard(a);}
  /* 这张卡片要不要重画：画师数据、是不是编辑态、生图队列状态、固定测试格数量，全一样就别动它。
     不重画 = 图片不重新取、不重新淡入。以前只要 render() 一次，屏幕上每张卡片的图都要重新淡入一遍，
     看着就是「整屏闪一下」——保存、生图状态变化、搜索框敲字、加载更多都会踩到。 */
  function cardKey(a){
    const active=genQueue.current,waiting=active&&active.uid===a.uid;
    const editing=draft&&(a===draft||(editingId&&a.uid===editingId));
    // 编辑器有自己的草稿生命周期：后台任务与筛选不能重建输入框或选图器。
    if(editing)return 'edit/'+editorRevision;
    const queue=waiting?`run${genQueue.waiting?1:0}`:`q${genQueue.positionOf(item=>item.uid===a.uid)||0}`;
    // 删除导致 order 连续重排，但卡片显示稳定 uid 序号，不必让相邻作品重载。
    return `show/${reservedOf()}/${PREVIEW_SLOTS}/${queue}/${collectingUid===a.uid?'collecting':''}/${JSON.stringify({...a,order:seqOf(a)})}`;
  }
  /* 卡片内容就地更新完了（编辑态里那一排作品格），同步一下指纹。 */
  const markEditorPainted=()=>{if(draft)ArtistGallery.markPainted(editingId||draft.uid);};
  function editingCard(a){
    const article=el('article','artist is-editing'),info=el('div','artist-info');
    /* 编辑态明确区分本库已收录图片与站点作品总数。 */
    const countText=()=>'本库图片 '+draft.works.length+' · 站点作品 '+(draft.counts?.total??'未读取');
    article.setAttribute('aria-label','编辑画师 '+(draft.name||'新画师'));
    const editorHead=el('div','editor-head'),numbers=el('div','artist-numbers'),workCount=el('span','work-count',countText());numbers.append(el('span','serial',String(seqOf(draft)).padStart(4,'0')),workCount);editorHead.append(numbers);info.append(editorHead);
    const field=(label,node)=>{const wrap=el('label','edit-field');wrap.append(el('span','edit-label',label),node);return wrap;};
    const fieldBox=(label,node)=>{const wrap=el('div','edit-field edit-field-wide');wrap.append(el('span','edit-label',label),node);return wrap;};
    const nameInput=el('input');nameInput.value=draft.name;nameInput.required=true;nameInput.maxLength=160;nameInput.placeholder='画师名字（必填）';nameInput.oninput=()=>{
      /* 手改名字就让旧的编号、数量、笔名作废——它们都属于上一个名字。
         放在这里而不是保存时判断：程序自己同步到的正式名不该被当成改名（那正是刚取回的新数据）。 */
      if(draft.name!==nameInput.value){draft.counts=null;draft.danbooruId=null;draft.aliases=[];draft.alias=null;}
      draft.name=nameInput.value;
    };
    const categorySelect=el('select');categorySelect.append(new Option('待判断',''),...data.categories.map(c=>new Option(c,c)));categorySelect.value=draft.category||'';categorySelect.onchange=()=>draft.category=categorySelect.value||null;
    const urlInput=el('input');urlInput.type='url';urlInput.value=draft.artistUrl||'';urlInput.placeholder='https://…';urlInput.oninput=()=>draft.artistUrl=urlInput.value;
    const tagEditor=el('div','tag-editor'),tagChoices=el('div','tag-choices'),tagRow=el('div','tag-editor-row'),tagNew=el('input');
    const renderTagEditor=()=>{
      const tags=unique([...data.tags,...draft.tags]);
      tagChoices.replaceChildren(...tags.map(tag=>{
        const on=draft.tags.includes(tag),choice=el('button',on?'tag-choice active':'tag-choice',tag);
        choice.type='button';choice.setAttribute('aria-pressed',String(on));
        choice.onclick=()=>{draft.tags=on?draft.tags.filter(x=>x!==tag):[...draft.tags,tag];renderTagEditor();};
        return choice;
      }));
      if(!tags.length)tagChoices.append(el('span','tag-choices-empty','还没有标签，在下面输入新建一个。'));
    };
    const addTag=value=>{const tag=String(value||'').trim().slice(0,40);if(!tag||!/[\p{L}\p{N}]/u.test(tag)||draft.tags.includes(tag))return false;draft.tags=[...draft.tags,tag];renderTagEditor();return true;};
    tagNew.maxLength=40;tagNew.placeholder='输入新标签后回车';tagNew.setAttribute('aria-label','新建标签');
    const tagAdd=el('button','action','添加');tagAdd.type='button';
    const commitNewTag=()=>{if(addTag(tagNew.value))tagNew.value='';tagNew.focus?.();};
    tagAdd.onclick=commitNewTag;
    tagNew.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();commitNewTag();}};
    tagRow.append(tagNew,tagAdd);
    tagEditor.append(tagChoices,tagRow);
    renderTagEditor();
    const scorePicker=el('div','score-picker');
    const renderScore=()=>{
      const nodes=[1,2,3,4,5].map(n=>{
        const on=draft.score===n,pick=el('button',on?'score-pick score-'+n+' active':'score-pick score-'+n,String(n));
        pick.type='button';pick.setAttribute('aria-pressed',String(on));pick.setAttribute('aria-label',n+' 分');
        pick.onclick=()=>{draft.score=on?null:n;renderScore();};
        return pick;
      });
      nodes.push(el('span','score-hint',draft.score?draft.score+' 分':'未评分，点数字打分'));
      scorePicker.replaceChildren(...nodes);
    };
    renderScore();
    const scoreField=el('div','edit-field');scoreField.append(el('span','edit-label','参考分数'),scorePicker);
    const aliasEditor=el('div','alias-editor'),aliasChoices=el('div','alias-picker'),aliasRow=el('div','alias-row'),aliasNew=el('input');
    const renderAliases=()=>{
      const nodes=(draft.aliases||[]).map(name=>{
        const on=draft.alias===name,chip=el('span',on?'alias-chip active':'alias-chip');
        const pick=el('button',on?'alias-choice active':'alias-choice',name);
        pick.type='button';pick.setAttribute('aria-pressed',String(on));
        pick.onclick=()=>{draft.alias=on?null:name;renderAliases();};
        const drop=el('button','alias-drop','×');drop.type='button';drop.setAttribute('aria-label','移除笔名 '+name);
        drop.onclick=()=>{draft.aliases=draft.aliases.filter(x=>x!==name);if(draft.alias===name)draft.alias=null;renderAliases();};
        chip.append(pick,drop);return chip;
      });
      if(!nodes.length)nodes.push(el('span','tag-choices-empty','保存时会从 Danbooru 读取笔名，也可以在下面自己添加。'));
      aliasChoices.replaceChildren(...nodes);
    };
    const addAlias=value=>{
      const name=String(value||'').trim().slice(0,60);
      if(!name)return;
      if(!draft.aliases.includes(name))draft.aliases=[...draft.aliases,name];
      draft.alias=name;renderAliases();
    };
    aliasNew.maxLength=60;aliasNew.placeholder='输入自定义笔名后回车';aliasNew.setAttribute('aria-label','新增笔名');
    const aliasAdd=el('button','action','添加');aliasAdd.type='button';
    const commitAlias=()=>{addAlias(aliasNew.value);aliasNew.value='';aliasNew.focus?.();};
    aliasAdd.onclick=commitAlias;
    aliasNew.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();commitAlias();}};
    aliasRow.append(aliasNew,aliasAdd);
    aliasEditor.append(aliasChoices,aliasRow);
    renderAliases();
    const aliasField=el('div','edit-field edit-field-wide');aliasField.append(el('span','edit-label','笔名（选用一个显示在名字下方，也可以自己添加）'),aliasEditor);
    const descInput=el('textarea');descInput.rows=3;descInput.maxLength=5000;descInput.value=draft.description||'';descInput.placeholder='记录画风和特点';descInput.oninput=()=>draft.description=descInput.value;
    const noteInput=el('textarea');noteInput.rows=2;noteInput.maxLength=5000;noteInput.value=draft.note||'';noteInput.placeholder='备注';noteInput.oninput=()=>draft.note=noteInput.value;
    const grid=el('div','edit-grid');grid.append(field('画师名字',nameInput),field('主分类',categorySelect),field('画师页面链接',urlInput),scoreField,fieldBox('标签',tagEditor),aliasField);
    editorError=el('p','error');editorError.setAttribute('role','alert');info.append(grid,field('画风描述',descInput),field('备注',noteInput),editorError);
    const actions=el('div','artist-actions');const remove=removeButton();remove.classList.add('edit-button');if(!editingId)remove.hidden=true;actions.append(remove,btn('刷新',refreshCurrentArtist,'edit-button'),btn('取消',cancelEdit,'edit-button'),btn('保存',saveDraft,'edit-button primary-action'));editorHead.append(actions);
    const works=el('div','works');
    /* 作品格单独可重画：从 Danbooru 勾一张就补一张，不动整张卡片——
       重画整张会把下面正在挑作品的候选列表一起冲掉。 */
    paintEditorWorks=()=>{
      workCount.textContent=countText();
      const pool=workPool(works),nodes=draft.works.map((w,i)=>takeWork(pool,draft,w,i,true));
      nodes.push(el('p','sample-note',`共 ${draft.works.length} 张图片 · 可单独移除；保存后才会写入画师目录`));
      reconcileWorks(works,nodes);
    };
    paintEditorWorks();
    const expand=el('section','artist-expand'),head=el('div','expand-head');
    /* 展开读取／收起就在标题旁边，一个按钮两副面孔：候选列表下面不再重复放一个「收起」。 */
    editorToggle=btn('展开读取',()=>togglePicker(expand),'action');
    editorExpand=expand;
    head.append(el('strong','','从 Danbooru 添加作品'),editorToggle);expand.append(head);
    article.append(info,works,expand);return article;
  }
  /* 当前筛选条件下的画师。渲染按它出卡片；「批量生成测试风格图」也按它填默认序号段。 */
  function currentRows(){return libraryIndex.select(data.artists,state);}
  function paintTasks(){
    const tasks=[batchRunning?'正在采集画师':'',syncingAll?'正在刷新资料':'',generating?'正在生成测试图':'',genQueue.pending?'等待生成 '+genQueue.pending+' 项':''].filter(Boolean).join(' · ');
    $('task-controls').hidden=!tasks;$('task-label').textContent=tasks;
    return tasks;
  }
  function render(){
    const restoreFocus=window.ArtistWorkspace?.captureFilterFocus();
    $('history-date').value=data.cutoffDate;$('save-large').checked=data.saveLargeImages===true;$('work-order').value=data.workOrder;
    const summary=libraryIndex.summary(data.artists),counts=summary.counts;
    const signature=JSON.stringify([data.categories,data.tags,[...counts],state.category,[...state.tags],[...state.scores],[...state.special]]);
    // 任务进度或搜索变化不重新创建筛选按钮；选择变化时恢复到同一个按钮。
    if(signature!==filterSignature){
      filterSignature=signature;
      $('categories').replaceChildren(...['全部',...data.categories,'待判断'].map(c=>{
        const b=btn(c,()=>{state.category=c;render();focusFirstArtist();},c===state.category?'active':'');b.dataset.filterKey='category:'+c;b.setAttribute('aria-pressed',String(c===state.category));b.append(el('span','n',counts.get(c)||0));return b;
      }));
      $('tags').replaceChildren(...data.tags.map(t=>{const b=btn(t,()=>{state.tags.has(t)?state.tags.delete(t):state.tags.add(t);render();},state.tags.has(t)?'active':'');b.dataset.filterKey='tag:'+t;b.setAttribute('aria-pressed',String(state.tags.has(t)));return b;}));
      const toggleScore=value=>{state.scores.has(value)?state.scores.delete(value):state.scores.add(value);render();};
      $('scores').replaceChildren(...[1,2,3,4,5,0].map(n=>{const on=state.scores.has(n),label=n?n+' 分':'未评分',b=btn(n?String(n):label,()=>toggleScore(n),(n?'score-pick score-'+n:'score-any')+(on?' active':''));b.dataset.filterKey='score:'+n;b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',label);b.title=label;return b;}));
      const toggleSpecial=key=>{state.special.has(key)?state.special.delete(key):state.special.add(key);render();};
      $('special').replaceChildren(...SPECIAL_FILTERS.map(([key,label])=>{const on=state.special.has(key),b=btn(label,()=>toggleSpecial(key),'special-pick'+(on?' active':''));b.dataset.filterKey='special:'+key;b.setAttribute('aria-pressed',String(on));return b;}));
    }
    const chips=[];
    const chip=(key,label,remove)=>{const b=btn(label+' ×',()=>{remove();render();},'filter-chip');b.dataset.filterKey=key;b.setAttribute('aria-label','移除筛选：'+label);chips.push(b);};
    if(state.category!=='全部')chip('category',state.category,()=>state.category='全部');
    for(const tag of state.tags)chip('tag:'+tag,tag,()=>state.tags.delete(tag));
    for(const score of state.scores)chip('score:'+score,score?score+' 分':'未评分',()=>state.scores.delete(score));
    for(const [key,label] of SPECIAL_FILTERS)if(state.special.has(key))chip('special:'+key,label,()=>state.special.delete(key));
    if(state.query)chip('query','搜索：'+state.query,()=>{state.query='';$('search').value='';});
    $('active-filters').replaceChildren(...chips);$('active-filters').hidden=!chips.length;
    const rows=currentRows();
    if(draft&&!editingId)rows.push(draft);
    else if(draft&&editingId&&!rows.some(a=>a.uid===editingId)){const editing=data.artists.find(a=>a.uid===editingId);if(editing)rows.unshift(editing);}
    ArtistGallery.render($('gallery'),rows,card,cardKey,patchCard);
    /* 编辑态收起后，作品格的图片到这里才释放：上面那次重画已经拿旧内容克隆过渐隐副本了。 */
    if(editorImagesPending&&!draft){editorImagesPending=false;ArtistImages.dispose('editor');}
    $('empty').hidden=rows.length!==0;
    $('library-summary').textContent=summary.total+' 位画师 · '+summary.works+' 张作品参考 · '+summary.tests+' 张测试风格图';
    $('sample-date').textContent=data.date?'样本日期 '+data.date:'';
    const tasks=paintTasks();
    window.ArtistWorkspace?.update({connected:!!folder,total:summary.total,rows:rows.length,category:state.category,editing:!!draft,tasks,filterCount:chips.length});
    restoreFocus?.();
    // 提前渲染或异步挂载产生的新控件也必须服从串行保存锁。
    if(pendingSaves)lockSaveControls();
  }
  let editorPicker=null,editorHost=null,editorError=null,editorToggle=null,editorExpand=null,paintEditorWorks=null,editorFocusVersion=0;
  /* 固定栏压住视口顶部的厚度：分类栏 + 页头，再加一点呼吸。
     它随时会变（筛选面板展开、已选条件多一行），所以每次滚之前重新算。 */
  function stickyOffset(){return ($('categories')?.closest?.('.library-controls')?.offsetHeight||120)+(document.querySelector('.app-header')?.offsetHeight||66)+14;}
  /* 把一个元素按到该在的位置：默认固定栏正下方，align='center' 则居中。
     滚动本身还是 scrollIntoView，但「滚完到底对不对」不再靠猜时间——旧写法是滚完等 420ms
     再量一次、偏了就瞬时补齐，而那个校验点常常正好落在平滑滚动还没跑完的时候：它按当时的
     文档高度瞬间对齐，之后列表继续挂载/释放、位置又跑了，可它已经是最后一道修正。
     于是同一个分类点两次会落到不同的地方，文档越长越明显（实测 20 次触发里 3 次偏离目标、
     最深 14px，还有 13 次伴随 +15~+292px 的「校验之后卡片仍在动」）。
     现在等位置真的停下来（连续两帧不动）再量；确实偏了、且不是「页面已经滚到底」才补一次，
     最多补两次，补的时候瞬时对齐，不叠第二层动画。 */
  let revealToken=0;
  function revealElement(element,{align='start',attempt=0}={}){
    if(!element?.scrollIntoView)return;
    const token=++revealToken;
    const want=()=>align==='center'?Math.max(0,((window.innerHeight||0)-element.getBoundingClientRect().height)/2):stickyOffset();
    const go=behavior=>{
      if(align!=='center'&&element.style?.setProperty)element.style.setProperty('scroll-margin-top',want()+'px');
      element.scrollIntoView({block:align==='center'?'center':'start',behavior});
    };
    go(attempt||reducedMotion()?'auto':'smooth');
    let last=-1,still=0;
    const settle=()=>{
      if(token!==revealToken)return;
      const y=Math.round(window.scrollY||0);
      if(y!==last){last=y;still=0;requestAnimationFrame(settle);return;}
      if(++still<2){requestAnimationFrame(settle);return;}
      /* 已经对齐，或者页面就这么点内容（短列表永远够不到固定栏下方）——都不再动它。 */
      const max=Math.max(0,(Number(document.documentElement?.scrollHeight)||0)-(window.innerHeight||0));
      if(Math.abs(element.getBoundingClientRect().top-want())<=2||Math.abs(y-max)<1||attempt>=2)return;
      revealElement(element,{align,attempt:attempt+1});
    };
    requestAnimationFrame(settle);
  }
  function focusFirstArtist(){
    const version=++editorFocusVersion;
    requestAnimationFrame(()=>{
      if(version!==editorFocusVersion)return;
      const first=$('gallery').firstElementChild;if(!first){$('empty').tabIndex=-1;$('empty').focus?.({preventScroll:true});return;}
      ArtistGallery.mount(first.dataset.uid);const card=first.querySelector('.artist');if(!card)return;
      card.tabIndex=-1;card.focus({preventScroll:true});
      revealElement(card);
    });
  }
  function setEditorError(message){if(editorError)editorError.textContent=message;if(message)shake(editorError);}
  /* 收起要把容器本身从页面移除：dispose() 已经清空了它的内容，只清内容会留下一个空壳。 */
  function closeWorkPicker(){if(editorPicker){editorPicker.dispose();editorPicker=null;}if(editorHost){editorHost.remove?.();editorHost=null;}if(editorToggle)editorToggle.textContent='展开读取';}
  /* 换排序、翻页之后把视线交回画师作品：候选列表换了一批，人还停在原地就不用动（nearest 只在看不见时才滚）。 */
  function focusEditorWorks(mode='nearest'){
    if(!draft)return;
    requestAnimationFrame(()=>{
      document.querySelector('.artist-slot[data-uid="'+(editingId||draft.uid)+'"] .works')?.scrollIntoView({block:mode,behavior:reducedMotion()?'auto':'smooth'});
    });
  }
  /* 勾选即加入：候选列表里勾一张，这里就把它的预览图存进草稿的作品列表，并就地补上那一格。
     全程不重画整张卡片，所以下面的候选列表不会被打断。 */
  async function addPickedWork(work){
    const target=draft;if(!target)throw Error('编辑已关闭');const [saved]=await cacheWorks(target.uid,[work]);
    if(draft!==target)throw Error('编辑已切换，未加入旧作品');const settle=rememberWorkSlots();
    draft.works.push(saved);paintEditorWorks();markEditorPainted();settle();
    return saved;
  }
  function removePickedWork(work){
    const index=draft.works.findIndex(w=>w.id&&String(w.id)===String(work.id));
    if(index<0)return false;
    const settle=rememberWorkSlots();
    draft.works.splice(index,1);paintEditorWorks();markEditorPainted();settle();
    return true;
  }
  function togglePicker(expand,manual=true){
    /* 收起之后卡片会变矮，视图要重新对准这张卡片，否则滚动位置会跑掉。 */
    if(editorPicker){closeWorkPicker();focusEditingCard();return;}
    const tag=(draft.name||'').trim();
    if(!tag){setEditorError('先在「画师名字」里填 Danbooru 标签，再用它去找作品。');return;}
    setEditorError('');
    editorHost=el('div','work-picker');expand.append(editorHost);
    if(editorToggle)editorToggle.textContent='收起';
    const exclude=new Set(draft.works.map(w=>w.id).filter(Boolean));
    editorPicker=WorkPicker.mount(editorHost,{uid:draft.uid,tag,exclude,order:data.workOrder,orderOptions:WORK_ORDER_OPTIONS,
      onPreview:work=>previewWork(draft.name,work,draft.uid),onAdd:addPickedWork,onRemove:removePickedWork,onAlign:focusEditorWorks});
    /* 手动展开时把作品格顶到视口上沿：作品格与第一行候选同时入画；翻页与换排序则只在看不见时才拉回来。 */
    if(manual){editorFocusVersion++;editorPicker.focus('start');}
  }
  function focusEditingCard(){
    if(!draft)return;
    const uid=editingId||draft.uid,focusVersion=++editorFocusVersion,find=()=>document.querySelector('.artist-slot[data-uid="'+uid+'"]');
    requestAnimationFrame(()=>{
      if(focusVersion!==editorFocusVersion)return;ArtistGallery.mount(uid);
      const slot=find();if(!slot)return;
      /* 收起作品选择器之后卡片会变矮，同样要把这张卡重新对准固定栏；偏移量由 revealElement 现算，
         不再像以前那样在校验里写死 200px。 */
      revealElement(slot);
    });
  }
  function startEdit(a){
    if(busy)return;
    $('quick-dialog').close();
    closeEditor();
    editingId=a?.uid||null;
    /* 草稿也要带上「将要拿到的序号」：卡片顶部按它显示，缺了就画出 undefined。
       真正的序号在保存时才发，这里只是给它一个可读的占位。 */
    draft=a?clone(a):{uid:uid(),order:ArtistId.nextSeq(data.artists),name:'',category:null,score:null,aliases:[],alias:null,tags:[],artistUrl:'',description:'',note:'',works:[]};
    editorRevision++;ArtistGallery.pin(editingId||draft.uid,true);
    /* 同一张卡片就地变成编辑态：高度由画廊那边平滑展开，下面的卡片顺着文档流被一起推开。
       以前是先给旧卡片一个淡出、等 130ms 再重画，看着就是「旧卡消失、新卡出现」。 */
    render();focusEditingCard();autoOpenPicker();
  }
  /* 设置里开了「编辑画师时自动展开 danbooru 作品」：一进编辑态就把候选列表拉出来。
     名字还空着的（新建画师）先不动——那时展开只会弹一句「先填名字」；等填好名字再点按钮即可。 */
  function autoOpenPicker(){
    if(!data?.autoOpenWorks||!draft||editorPicker||!editorExpand)return;
    if(!(draft.name||'').trim())return;
    togglePicker(editorExpand,false);
  }
  function cancelEdit(){
    if(busy||uploading)return;
    /* 收起同样就地收缩：高度动画在画廊那边，不走「淡出再重画」。 */
    closeEditor();render();
  }
  /* 编辑态作品格的图片不能在这里就释放：卡片还要留一份副本做渐隐，而克隆必须发生在图片被清空之前
     （释放会把 img 的 src 摘掉，克隆出来就是一张空卡）。真正的释放推迟到下一次 render——
     那时新内容已经就位、渐隐副本也已经克隆好了。 */
  let editorImagesPending=false;
  function closeEditor(){editorFocusVersion++;if(draft)ArtistGallery.pin(editingId||draft.uid,false);editorImagesPending=true;closeWorkPicker();editingId=null;draft=null;editorError=null;editorToggle=null;editorExpand=null;paintEditorWorks=null;}
  /* 从候选里挑出唯一可信的那一位：名字完全一致优先，只有一位候选时也接受。
     其余情况返回 null —— 宁可没有编号，也不写错。 */
  const pickCandidate=(found,name)=>{
    const list=Array.isArray(found)?found:[],exact=list.filter(c=>c.name&&c.name.toLowerCase()===name.toLowerCase());
    return exact.length===1?exact[0]:(list.length===1?list[0]:null);
  };
  /* 用库里存的名字去站点查这位画师。旧名可能只留在站点的 other_names 里，
     所以先用明确覆盖 other name 的 any_name_matches，查不到再退回默认的综合搜索。 */
  async function lookupArtist(name){
    let hit=pickCandidate(await ArtistLookup.lookup(ArtistLookup.plan(name,{match:'name'})),name);
    if(!hit)hit=pickCandidate(await ArtistLookup.lookup(ArtistLookup.plan(name)),name);
    /* 名字、组名、别名都对不上时，再按主页地址找一次：像 yotte615 这种只出现在
       画师主页地址里的字符串，前两路永远搜不到，只有 url_matches 能命中。 */
    if(!hit)hit=pickCandidate(await ArtistLookup.lookup(ArtistLookup.plan(name,{match:'url'})),name);
    if(!hit)return null;
    const canonical=typeof hit.name==='string'&&hit.name.trim()?hit.name.trim():null;
    return {id:hit.id,canonical,aliases:hit.aliases||[]};
  }
  /* 按名字与编号重算 uid；变了就登记目录迁移。不登记的话 write 会删掉旧目录，
     里面的缩略图与大图会一起没有。返回是否换了标识。 */
  function reidentify(artist,name,danbooruId){
    const parsed=ArtistId.parse(artist.uid),uid=ArtistId.create({seq:parsed?parsed.seq:artist.order,name,danbooruId:danbooruId??null});
    if(uid===artist.uid)return false;
    FolderStore.rename(folder,artist.uid,uid);artist.uid=uid;return true;
  }
  /* 读一次作品数量（含截至日期前数量）。失败项保留原值，不覆盖成 null。
     笔名不在这里读：它在「识别添加」和「批量导入」时随画师编号一起取回，只取一次，
     保存时再查一遍纯属浪费一次完整往返。 */
  async function refreshCounts(artist,cutoffDate=data.cutoffDate){
    const result=await ArtistLookup.details(artist.name,cutoffDate,{previews:false});
    const counts={...(artist.counts||{})};
    if(result.counts.total!==null){counts.total=result.counts.total;counts.checkedAt=result.counts.checkedAt;}
    if(result.counts.beforeTotal!==null){counts.beforeTotal=result.counts.beforeTotal;counts.beforeDate=cutoffDate;}
    return {counts,partial:result.countsError};
  }
  const SYNC_CHUNK=25,SYNC_CONCURRENCY=3;
  let syncingAll=false,syncAllStop=false;
  /* 全库刷新：每位画师都重新核对站点上的正式名，并刷新作品数量。按批写盘，
     中途停下来时已经刷好的部分已经落盘，不会白跑。 */
  async function syncAllArtists(){
    if(busy||syncingAll)return;
    const targets=data.artists.map(a=>({uid:a.uid,name:a.name,counts:clone(a.counts||{})}));
    if(!targets.length){status('画师库还是空的，先添加画师。',true);return;}
    const button=$('sync-all');
    let done=0,renamed=0,skipped=0,failed=0;
    const paint=()=>{button.textContent=`停止刷新（${done} / ${targets.length}）`;};
    syncingAll=true;syncAllStop=false;
    button.classList.add('danger');button.classList.add('is-armed');paint();
    try{
      for(let i=0;i<targets.length;i+=SYNC_CHUNK){
        if(syncAllStop)break;
        const slice=targets.slice(i,i+SYNC_CHUNK),results=[],cutoffDate=data.cutoffDate;
        let cursor=0;
        await Promise.all(Array.from({length:Math.min(SYNC_CONCURRENCY,slice.length)},async()=>{
          while(cursor<slice.length&&!syncAllStop){
            const item=slice[cursor++];
            try{
              const [hit,counts]=await Promise.all([lookupArtist(item.name),refreshCounts(item,cutoffDate)]);
              results.push({item,hit,counts});
            }catch{failed++;}
            done++;paint();
          }
        }));
        const saved=await save(next=>{
          const takenNames=new Set(next.artists.map(a=>a.name.toLowerCase()));
          for(const {item,hit,counts} of results){
            const target=next.artists.find(a=>a.uid===item.uid);
            // 查询期间删除或改名的画师不再套用旧查询结果。
            if(!target||target.name!==item.name){skipped++;continue;}
            if(counts)target.counts={...target.counts,...counts.counts};
            const canonical=hit&&hit.canonical;
            if(!canonical||canonical===target.name||takenNames.has(canonical.toLowerCase())){skipped++;continue;}
            takenNames.delete(target.name.toLowerCase());takenNames.add(canonical.toLowerCase());
            reidentify(target,canonical,hit.id);target.name=canonical;
            if(hit.id!=null)target.danbooruId=hit.id;
            if(hit.aliases.length)target.aliases=hit.aliases;
            renamed++;
          }
          return next;
        },`正在刷新画师数据 ${done} / ${targets.length}…`);
        if(!saved&&folder)return;
      }
    }finally{
      syncingAll=false;
      button.classList.remove('is-armed');button.classList.remove('danger');button.textContent='开始刷新';
    }
    status(syncAllStop?`已停止：刷新了 ${done} / ${targets.length} 位画师的数据${failed?`，${failed} 位读取失败`:''}。`:`已刷新 ${targets.length} 位画师的数据：${renamed} 位改用站点上的最新名${skipped?`，${skipped} 位名字没变或会撞名`:''}${failed?`，${failed} 位读取失败`:''}。`,failed>0);
  }
  /* 刷新当前画师：和「刷新所有画师数据」做同样的事，只是只针对编辑中的这一位。
     结果先写进编辑表单，点保存才落盘——在编辑器里直接落盘会让「取消」失去意义。 */
  async function refreshCurrentArtist(){
    if(busy||uploading||!draft)return;
    const name=(draft.name||'').trim();
    if(!name){setEditorError('先在「画师名字」里填 Danbooru 标签，再刷新。');return;}
    setEditorError('');busy=true;status('正在刷新 '+name+' 的数据…');
    const notes=[];let bad=false;
    try{
      const [hit,counts]=await Promise.all([lookupArtist(name).catch(()=>null),refreshCounts({...draft,name}).catch(()=>null)]);
      if(counts)draft.counts=counts.counts;
      if(!hit){notes.push('站点上没找到这位画师');bad=true;}
      else{
        if(hit.id!=null)draft.danbooruId=hit.id;
        if(hit.aliases.length)draft.aliases=hit.aliases;
        if(hit.canonical&&hit.canonical!==name){
          const taken=data.artists.some(a=>a.uid!==editingId&&a.name.toLowerCase()===hit.canonical.toLowerCase());
          if(taken){notes.push('站点上已改名为 '+hit.canonical+'，但库里已有同名画师，没有跟着改');bad=true;}
          else{draft.name=hit.canonical;notes.push('站点上已改名为 '+hit.canonical+'，已跟着改');}
        }
      }
    }finally{busy=false;}
    closeWorkPicker();editorRevision++;render();
    status(notes.length?'已刷新 '+name+'：'+notes.join('；')+'。保存后才会落盘。':'已刷新 '+name+' 的作品数量与笔名。保存后才会落盘。',bad);
  }
  async function saveDraft(){
    if(busy||uploading)return;
    const name=(draft.name||'').trim();
    if(!name){setEditorError('请填写画师名字。');return;}
    if(data.artists.some(a=>a.uid!==editingId&&a.name.toLowerCase()===name.toLowerCase())){setEditorError('已有同名画师。');return;}
    if(draft.artistUrl&&!url(draft.artistUrl)){setEditorError('画师页面链接只支持 http:// 或 https://。');return;}
    if(draft.works.some(w=>w.url&&!url(w.url))){setEditorError('作品来源链接只支持 http:// 或 https://。');return;}
    /* 旧编号、数量、笔名的作废放在名字输入框里做，这里只负责把改过的名字落到 uid 上。 */
    draft.name=name;draft.artistUrl=url(draft.artistUrl);draft.tags=unique(draft.tags);draft.basis='';draft.status='';draft.works.forEach(w=>w.url=url(w.url));
    const edited=clone(draft),editing=editingId;
    await save(next=>{
      const i=next.artists.findIndex(a=>a.uid===editing);
      if(editing&&i<0)throw reject('这位画师已经被删除或改名，请重新打开编辑');
      if(next.artists.some(a=>a.uid!==editing&&a.name.toLowerCase()===name.toLowerCase()))throw reject('已有同名画师');
      if(i<0){edited.uid=ArtistId.issue(next.artists,{name:edited.name,danbooruId:edited.danbooruId});next.artists.push(edited);}
      else{
        const seq=ArtistId.parse(edited.uid)?.seq;
        if(seq&&ArtistId.create({seq,name:edited.name,danbooruId:edited.danbooruId})!==edited.uid)reidentify(edited,edited.name,edited.danbooruId);
        next.artists[i]=edited;
      }
      next.artists.forEach((a,j)=>a.order=j+1);next.tags=unique([...next.tags,...edited.tags]);return next;
    },'已保存 '+name,()=>{closeEditor();render();});
  }

  /* 删除画师。编辑态的「删除画师」和浏览卡片上的那个都走这里：删的是 uid 这一位；
     正在编辑的就是他时，顺手把编辑态收掉。 */
  async function removeArtist(uid=editingId){
    if(busy||uploading||!uid)return;
    await save(next=>{next.artists=next.artists.filter(a=>a.uid!==uid);next.artists.forEach((a,i)=>a.order=i+1);return next;},'已删除画师',()=>{if(uid===editingId)closeEditor();render();});
  }
  function confirmButton(label,armedLabel,onConfirm,cls='danger'){
    let armed=false,timer=null;
    const button=btn(label,async()=>{
      if(busy||uploading)return;
      if(!armed){
        armed=true;button.textContent=armedLabel;button.classList.add('is-armed');
        timer=setTimeout(()=>{armed=false;button.textContent=label;button.classList.remove('is-armed');},4000);
        return;
      }
      clearTimeout(timer);armed=false;
      await onConfirm();
    },cls);
    return button;
  }
  const removeButton=()=>confirmButton('删除画师','再次点击确认删除',()=>removeArtist(editingId));
  /* 浏览态卡片上也能删：和编辑态那个删除按钮走同一套「点两次」的逻辑，删的是这张卡片这一位。 */
  const deleteArtistButton=a=>{const button=confirmButton('删除','确认删除',()=>removeArtist(a.uid),'edit-button danger');button.setAttribute('aria-label','删除画师 '+a.name);return button;};
  const readImage=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败。'));reader.readAsDataURL(file);});
  const thumbnail=dataUrl=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{try{const scale=Math.min(1,400/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.8));}catch{reject(Error('图片处理失败。'));}};img.onerror=()=>reject(Error('图片读取失败。'));img.src=dataUrl;});
  const manageFilter={category:'',tag:''};
  let dragging=null;
  const clearDropMarks=()=>{for(const node of document.querySelectorAll('.drop-before,.drop-after'))node.classList.remove('drop-before','drop-after');};
  const moveItem=(list,from,to)=>{if(from===to||from<0||to<0||from>=list.length||to>=list.length)return list;const next=[...list],[item]=next.splice(from,1);next.splice(to,0,item);return next;};
  /* 列表行平时只显示名字，点「重命名」才就地把这一行换成输入框；
     传入 onMove 时额外给一个拖动把手，只有未筛选时才提供，避免顺序歧义 */
  function manageRow(name,{onRename,onRemove,relist,onMove,index}={}){
    const row=el('div','manage-tag-row');
    const edit=()=>{
      const input=el('input');input.value=name;input.maxLength=40;input.setAttribute('aria-label','重命名 '+name);
      const keep=btn('保存',()=>onRename(input.value.trim(),name)),drop=btn('取消',()=>relist());
      input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();keep.onclick();}else if(event.key==='Escape'){event.preventDefault();drop.onclick();}};
      row.replaceChildren(input,keep,drop);
      input.focus?.();input.select?.();
    };
    const parts=[];
    if(typeof onMove==='function'){
      const handle=el('button','manage-handle','⠿');handle.type='button';handle.draggable=true;
      handle.setAttribute('aria-label','调整顺序：'+name+'，上下方向键移动');
      handle.onkeydown=event=>{if(!['ArrowUp','ArrowDown'].includes(event.key)||busy)return;event.preventDefault();onMove(index,index+(event.key==='ArrowUp'?-1:1));};
      handle.ondragstart=event=>{dragging={name,index};row.classList.add('is-dragging');event.dataTransfer?.setData('text/plain',name);};
      handle.ondragend=()=>{dragging=null;row.classList.remove('is-dragging');clearDropMarks();};
      row.ondragover=event=>{if(!dragging||dragging.name===name)return;event.preventDefault();clearDropMarks();row.classList.add(dragging.index<index?'drop-after':'drop-before');};
      row.ondragleave=()=>row.classList.remove('drop-before','drop-after');
      row.ondrop=event=>{if(!dragging||dragging.name===name)return;event.preventDefault();const from=dragging.index;clearDropMarks();dragging=null;onMove(from,index);};
      parts.push(handle);
    }
    parts.push(el('span','manage-name',name),btn('重命名',edit),confirmButton('删除','确认删除？',()=>onRemove(name)));
    row.append(...parts);
    return row;
  }
  const manageMatch=(value,filter)=>!filter||String(value).toLowerCase().includes(filter);
  function fillManageEmpty(id,filter,count,what){
    const empty=$(id);empty.hidden=count>0;
    empty.textContent=filter?`没有匹配「${filter}」的${what}。`:`还没有任何${what}。`;
  }
  function showManageTab(which){
    const isCategory=which!=='tag';
    $('tab-category').classList[isCategory?'add':'remove']('active');
    $('tab-tag').classList[isCategory?'remove':'add']('active');
    $('tab-category').setAttribute('aria-selected',String(isCategory));$('tab-category').tabIndex=isCategory?0:-1;$('tab-tag').tabIndex=isCategory?-1:0;
    $('tab-tag').setAttribute('aria-selected',String(!isCategory));
    $('panel-category').hidden=!isCategory;
    $('panel-tag').hidden=isCategory;
  }
  function listCategories(){
    const filter=manageFilter.category,sortable=!filter,visible=data.categories.filter(c=>manageMatch(c,filter));
    $('category-list').replaceChildren(...visible.map((c,index)=>manageRow(c,{
      relist:listCategories,index,
      onMove:sortable?async(from,to)=>{
        if(busy||from===to)return;
        const next=clone(data);next.categories=moveItem(next.categories,from,to);
        await save(next,'已调整分类顺序');listCategories();
      }:undefined,
      onRename:(name,from)=>{
        if(busy)return;
        if(!name||name===from){listCategories();return;}
        if(data.categories.includes(name)){alert('这个分类已存在。');listCategories();return;}
        const next=clone(data);next.categories=next.categories.map(x=>x===from?name:x);next.artists.forEach(a=>{if(a.category===from)a.category=name;});if(state.category===from)state.category=name;
        return save(next).then(listCategories);
      },
      onRemove:async from=>{
        const used=data.artists.filter(a=>a.category===from).length;
        const next=clone(data);next.categories=next.categories.filter(x=>x!==from);next.artists.forEach(a=>{if(a.category===from)a.category=null;});if(state.category===from)state.category='全部';
        await save(next,used?`已删除分类「${from}」，${used} 位画师回到「待判断」`:`已删除分类「${from}」`);listCategories();
      }
    })));
    fillManageEmpty('category-empty',filter,visible.length,'分类');
  }
  function listTags(){
    const filter=manageFilter.tag,sortable=!filter,visible=data.tags.filter(t=>manageMatch(t,filter));
    $('tag-list').replaceChildren(...visible.map((t,index)=>manageRow(t,{
      relist:listTags,index,
      onMove:sortable?async(from,to)=>{
        if(busy||from===to)return;
        const next=clone(data);next.tags=moveItem(next.tags,from,to);
        await save(next,'已调整标签顺序');listTags();
      }:undefined,
      onRename:(name,from)=>{
        if(busy)return;
        if(!name||name===from){listTags();return;}
        if(data.tags.includes(name)){alert('这个标签已存在。');listTags();return;}
        const next=clone(data);next.tags=next.tags.map(x=>x===from?name:x);next.artists.forEach(a=>a.tags=a.tags.map(x=>x===from?name:x));if(state.tags.delete(from))state.tags.add(name);
        return save(next).then(listTags);
      },
      onRemove:async from=>{
        const used=data.artists.filter(a=>a.tags.includes(from)).length;
        const next=clone(data);next.tags=next.tags.filter(x=>x!==from);next.artists.forEach(a=>a.tags=a.tags.filter(x=>x!==from));state.tags.delete(from);
        await save(next,used?`已删除标签「${from}」，${used} 位画师已移除该标签`:`已删除标签「${from}」`);listTags();
      }
    })));
    fillManageEmpty('tag-empty',filter,visible.length,'标签');
  }
  async function exportData(){
    if(busy)return;let stream;const controls=[...document.querySelectorAll('button,input,textarea,select')].map(e=>[e,e.disabled]);
    try{const handle=await window.showSaveFilePicker({suggestedName:'画师库备份_'+new Date().toISOString().slice(0,10)+'.json',types:[{description:'画师库 JSON',accept:{'application/json':['.json']}}]});busy=true;controls.forEach(([e])=>e.disabled=true);stream=await handle.createWritable();await FolderStore.exportTo(folder,data,stream,(i,n)=>status(`正在导出 ${i} / ${n} 位画师…`));await stream.close();stream=null;status('备份已保存：只有资料和图片地址，不含任何图片数据；恢复后缩略图与原图都按链接重新取。要留下图片本身，请复制整个「数据」文件夹。');
    }catch(error){if(stream)await stream.abort().catch(()=>{});if(error.name!=='AbortError')status('备份失败：'+error.message,true);}finally{busy=false;controls.forEach(([e,disabled])=>e.disabled=disabled);}
  }
  async function importData(e){
    const f=e.target.files[0];e.target.value='';if(!f||busy)return;
    try{if(f.size>100*1024*1024)throw Error('超过 100 MB 的备份请使用完整「数据」文件夹恢复，避免一次解析全部图片占满内存。');const next=normalize(JSON.parse(await f.text()),true);if(next.artists.some(a=>a.works.some(w=>FolderStore.imageOf(w,'thumb')?.kind==='local')))throw Error('这份 JSON 里的图片指向本地文件路径，单独导入恢复不了图片；请直接选对应的「数据」文件夹。');if(!confirm(`用备份中的 ${next.artists.length} 位画师替换当前 ${data.artists.length} 位？建议先导出当前备份。`))return;reset();await save(next,'已导入备份');ArtistImages.clear();}catch(error){alert('导入失败。\n'+error.message);}
  }
  const BATCH_WORKS=3;
  let batchStop=false,batchRunning=false;const batchFailed=[];
  /* 正在采集哪一位：卡片据此显示「采集中」，让进度落到具体那张卡上，
     而不是只有页面底部一行字。 */
  let collectingUid=null;
  function setCollecting(uid){
    if(collectingUid===uid)return;
    collectingUid=uid;render();
  }
  /* 采集期间：工具栏与对话框里都给出「停止采集」，并把进度同时写到页面底部——
     对话框收起以后，主页面那一行仍然看得见进度。 */
  function setBatchRunning(value){
    batchRunning=value;
    for(const id of ['batch-stop','batch-stop-dialog'])$(id).hidden=!value;
    const run=$('batch-run');run.disabled=value;if(!value)run.textContent='添加到画师库';
  }
  async function enrichArtists(targets,order=DEFAULT_WORK_ORDER){
    const message=$('batch-message'),total=targets.length;
    let done=0,failed=0,renamed=0,images=0,degraded=0;
    const text=()=>`正在采集 ${done} / ${total} · 补编号 ${renamed} · 缩略图 ${images} 张${degraded?` · 数量待补 ${degraded}`:''}${failed?` · 失败 ${failed}`:''}`;
    try{
    for(const job of targets){
      if(batchStop)break;
      const source=data.artists.find(a=>a.uid===job.uid);done++;
      if(!source||source.counts?.checkedAt)continue;
      const name=source.name,cutoffDate=data.cutoffDate;
      setCollecting(job.uid);
      try{
        /* 先认人、再查作品：站点上真正有作品的是「正式名」，输入的那串往往只是别名或推特号
           （mikazukimo_4780 就是这种情况）。以往顺序是反的——先用输入名查完数量与作品、
           之后才去核对正式名，于是识别画师与右键建卡都能读到作品，只有批量采集采回 0 张。 */
        let hit=null;try{hit=await lookupArtist(name);}catch{}
        const queryName=hit&&hit.canonical?hit.canonical:name;
        const detail=await ArtistLookup.details(queryName,cutoffDate,{previews:true,order});
        /* 作品、数量是两路各自独立的请求，失败要说清是哪一路，而且一位只算一次「待补」：
           - 什么都没读到 = 失败（以往这种情况不打失败也不写原因，汇总只写「缩略图 0 张」，像采成功了）；
           - 只缺数量 = 待补，作品照常落盘（以往数量一失败就整位作废，连读回来的作品也一起丢）；
           - 只缺作品 = 待补，且原因必须写出来（这就是 mikazukimo_4780 那一次：编号和数量都写进去了，
             缩略图一张没有，汇总里完全看不出来）。 */
        const hasWorks=Array.isArray(detail.works)&&detail.works.length>0,hasCount=!!detail.counts&&detail.counts.total!==null;
        if(!hasWorks&&!hasCount){failed++;if(batchFailed.length<5)batchFailed.push(name+'：作品列表与数量都读取失败'+(detail.previewError?'（'+detail.previewError+'）':'')+'，再提交同一名单会重试');continue;}
        if(detail.countsError){degraded++;if(batchFailed.length<5)batchFailed.push(name+'：作品数量读取失败，再提交同一名单会补');}
        else if(hasCount&&!hasWorks){degraded++;if(batchFailed.length<5)batchFailed.push(name+'：作品列表读取失败'+(detail.previewError?'（'+detail.previewError+'）':'')+'，只剩编号与数量，再提交同一名单可补作品');}
        const works=await cacheWorks(job.uid,detail.works.slice(0,BATCH_WORKS));
        const saved=await save(next=>{
          const artist=next.artists.find(a=>a.uid===job.uid);
          if(!artist||artist.name!==name)return next;
          const taken=new Set(next.artists.filter(a=>a!==artist).map(a=>a.name.toLowerCase()));
          const canonical=hit&&hit.canonical&&hit.canonical!==name&&!taken.has(hit.canonical.toLowerCase())?hit.canonical:name;
          const danbooruId=hit&&hit.id!=null?hit.id:(Number.isSafeInteger(artist.danbooruId)?artist.danbooruId:null);
          if(reidentify(artist,canonical,danbooruId))renamed++;
          artist.name=canonical;job.uid=artist.uid;
          if(danbooruId!=null)artist.danbooruId=danbooruId;
          if(hit&&hit.aliases.length)artist.aliases=hit.aliases;
          // 保留请求期间上传、编辑或生成的作品，只追加尚未保存的采集结果。
          const added=works.filter(w=>!artist.works.some(existing=>w.id?existing.id===w.id:w.url&&existing.url===w.url));
          artist.works.push(...added);
          // 数量读失败时保留原值（不写 checkedAt），再次提交同一名单会重试这一位。
          if(hasCount)artist.counts={...artist.counts,...detail.counts};
          images+=added.filter(w=>typeof w.thumb==='string'&&w.thumb.startsWith('data:')).length;
          return next;
        },text());
        if(!saved&&folder){batchStop=true;return {done,failed,renamed,images,storageFailed:true};}
      }catch(error){failed++;if(batchFailed.length<5)batchFailed.push(name+'：'+error.message);}
      const line=text();message.textContent=line;status(line);
    }
    return {done,failed,renamed,images,degraded};
    }finally{setCollecting(null);}
  }
  /* 超过这个人数、又勾了「同时生成测试风格图」时，按钮要变红再确认一次。 */
  const BATCH_CONFIRM_OVER=20;
  let batchArmed=false,batchArmTimer=null;
  function disarmBatch(){
    clearTimeout(batchArmTimer);batchArmTimer=null;
    if(!batchArmed)return;
    batchArmed=false;
    const button=$('batch-run');
    button.textContent='添加到画师库';button.classList.remove('is-armed');
  }
  /* 采集会同步更新任务里的 uid，正式名变化后也能找到同一位画师，逐个排入生成队列。
     排队是异步的，导入本身该结束就结束，不等生成。 */
  function queueTestImages(targets,stopped){
    if(stopped){status('导入已中止，没有排入生成需求。');return 0;}
    let queued=0;
    for(const job of targets){const artist=data.artists.find(a=>a.uid===job.uid);if(artist&&!artist.works.some(w=>w.kind==='test'&&(w.testSeq||1)===1)&&enqueueGenerate(artist,1,null))queued++;}
    if(queued)status(`已为 ${queued} 位画师排入「生成测试风格 1」，队列一条一条跑，两条之间隔 5±3 秒。`);
    return queued;
  }
  async function batch(e){
    e.preventDefault();if(busy||batchRunning)return;const names=unique($('batch-names').value.split(/\r?\n/));if(!names.length)return;if(names.some(n=>n.length>160)){$('batch-message').textContent='名字不能超过 160 个字符，请检查是否每行一位。';return;}
    const collect=$('batch-works').checked,alsoGenerate=$('batch-generate').checked,order=WORK_ORDERS.includes($('batch-order').value)?$('batch-order').value:data.workOrder;
    /* 人多、又要连着生图：先点红按钮确认一次，第二次点才真的开始。 */
    if(alsoGenerate&&names.length>BATCH_CONFIRM_OVER&&!batchArmed){
      batchArmed=true;
      const button=$('batch-run');
      button.classList.add('is-armed');button.textContent=`确认导入 ${names.length} 位？`;
      $('batch-message').textContent=`将导入 ${names.length} 位画师，并为他们各排一条「生成测试风格 1」的需求：共 ${names.length} 条，会在之后持续消耗额度或点数（一条一条跑，两条之间隔 5±3 秒）。确认无误请再点一次按钮。`;
      batchArmTimer=setTimeout(disarmBatch,8000);
      return;
    }
    disarmBatch();
    const next=clone(data),seen=new Set(next.artists.map(a=>a.name.toLowerCase())),targets=[];let count=0;
    for(const name of names){if(seen.has(name.toLowerCase())){const existing=next.artists.find(a=>a.name.toLowerCase()===name.toLowerCase());if(collect&&!existing.counts?.checkedAt&&!targets.some(job=>job.uid===existing.uid))targets.push({uid:existing.uid,name:existing.name});continue;}seen.add(name.toLowerCase());if(next.artists.length>=20000){$('batch-message').textContent='最多支持 20,000 位画师。';return;}next.artists.push({uid:ArtistId.issue(next.artists,{name}),order:next.artists.length+1,name,category:null,score:null,aliases:[],alias:null,tags:[],counts:{total:null,checkedAt:'',beforeDate:'',beforeTotal:null},artistUrl:'https://danbooru.donmai.us/posts?tags='+encodeURIComponent(name),description:'',note:'',works:[]});targets.push({uid:next.artists[next.artists.length-1].uid,name});count++;}
    batchStop=false;batchFailed.length=0;
    /* 采完就能看着新卡一张张补上：清掉筛选，把分类切到「待判断」——新加的画师都落在这里。 */
    reset();state.category='待判断';
    const saved=await save(next,`已添加 ${count} 位，跳过 ${names.length-count} 个重复名字`);
    if(!saved&&folder)return;
    const summary=`已添加 ${count} 位，跳过 ${names.length-count} 个重复名字`;
    if(collect&&targets.length){
      $('batch-message').textContent=`开始采集 ${targets.length} 位画师的最新 ${BATCH_WORKS} 张作品…`;
      setBatchRunning(true);
      let result;
      try{result=await enrichArtists(targets,order);}
      finally{setBatchRunning(false);}
      if(result.storageFailed)return;
      /* 失败与「待补」的原因都要写进汇总：以往明细只在「失败 N>0」时才拼上去，
         于是「编号认出来了、数量也回来了，作品却一张没采到」这种半成品一声不响地过去了。 */
      const notes=batchFailed.length?`（${batchFailed.join('；')}${batchFailed.length<result.failed+result.degraded?'；…':''}）`:'';
      const finished=`${summary}。采集 ${result.done} 位 · 补编号 ${result.renamed} · 缩略图 ${result.images} 张${result.degraded?` · 待补 ${result.degraded} 位`+notes:''}${result.failed?` · 失败 ${result.failed} 位`+(result.degraded?'':notes):''}${batchStop?' · 已中止，再次提交同一名单会跳过已采集的画师':''}。`;
      $('batch-message').textContent=finished;status(finished);
    }else $('batch-message').textContent=summary+'。';
    /* 采集完再排队：那时 uid 才是最终的，排进去的才会真的找到人。 */
    const queued=alsoGenerate?queueTestImages(targets,batchStop):0;
    if(queued)$('batch-message').textContent+=` 已排入 ${queued} 条生成需求，到后台队列慢慢跑。`;
    if($('batch-dialog').open&&!batchStop)$('batch-dialog').close();
  }
  let lookupTimer,lookupController,lookupSequence=0;
  /* 生图是否可用，取决于扩展版本：0.4.0 才带 NovelAI 生图通道。 */
  function updateGenStatus(){
    const node=$('gen-bridge'),ready=ArtistExtension.canGenerate;
    node.textContent=ready?`可以生成 · 图片助手 ${ArtistExtension.version}`:ArtistExtension.connected?`图片助手 ${ArtistExtension.version} 还不会生图：请在 chrome://extensions 重新加载扩展（需要 0.4.0 或更高）。`:'未检测到图片助手：生成前请先装好扩展并重新打开本网页。';
    node.classList.toggle('error',!ready);
  }
  async function checkExtension(){
    try{
      const version=await ArtistExtension.check(),stale=!ArtistExtension.canFetchApi;
      $('extension-status').textContent=stale?'图片助手版本过旧 · '+version+' · 点击重试':'图片助手已连接 · '+version;
      $('extension-status').title=stale?'请重新加载扩展，否则作品列表会退回匿名直连，图片地址可能取不到':'扩展取图可用';
      if(stale)status('扩展版本过旧（'+version+'）：读取作品列表会退回匿名直连，图片地址可能取不到。请在 chrome://extensions 重新加载扩展。',true);
      ArtistImages.clear();
    }catch(error){$('extension-status').textContent='图片助手未连接 · 点击重试';$('extension-status').title=error.message;status(error.message,true);}
    updateGenStatus();
  }
  async function cacheWorks(id,works){
    const result=[];
    for(const w of works){
      if(FolderStore.imageOf(w,'thumb')?.kind==='local'){result.push(w);continue;}
      try{const thumb=await ArtistImages.dataUrl(id,w,'thumb');result.push({...w,thumb,caption:w.caption?.startsWith('预览图未能')?'':w.caption});}
      catch(error){
        const smaller=typeof w.thumbUrl==='string'&&w.thumbUrl.includes('/360x360/')?w.thumbUrl.replace('/360x360/','/180x180/'):null;
        try{
          if(!smaller)throw error;
          const thumb=await ArtistImages.dataUrl(id,{...w,thumbUrl:smaller},'thumb');
          result.push({...w,thumb,thumbUrl:smaller,caption:''});
        }catch{result.push({...w,caption:'预览图未能缓存：'+error.message});}
      }
    }
    return result;
  }
  const lookupCache=new Map();let activePickers=[];
  let clearTimer;
  function clearCandidates(immediate=false){
    for(const picker of activePickers)picker.dispose();
    activePickers=[];
    const results=$('quick-results');clearTimeout(clearTimer);
    const flush=()=>{results.replaceChildren();results.classList.remove('is-leaving');};
    if(immediate||!results.children.length){flush();return;}
    results.classList.add('is-leaving');clearTimer=setTimeout(flush,140);
  }
  function cancelLookup(){clearTimeout(lookupTimer);lookupController?.abort();lookupSequence++;}
  function previewWork(name,work,uid){ArtistViewer.open({title:name+' #'+work.id,uid,work,caption:'候选作品，勾选后才会保存到画师库'});}
  function showCandidates(results,p,sequence){
    clearCandidates(true);
    $('quick-status').textContent=results.length?`找到 ${results.length} 位候选，请核对正式标签后勾选要保存的作品。`:'未找到匹配。可以使用站内检索检查别名或主页链接。';
    for(const artist of results){
      const row=el('div','candidate'),detail=el('div','candidate-info');detail.append(el('strong','',artist.name),el('span','',`Danbooru #${artist.id}`));
      if(artist.aliases.length)detail.append(el('small','',`笔名（${artist.aliases.length}）：${artist.aliases.slice(0,5).join('、')}${artist.aliases.length>5?' 等':''}`));detail.append(link('核对画师资料 ↗',artist.pageUrl));
      const countLine=el('small','','作品数量：读取中…');detail.append(countLine);
      const body=el('div','candidate-body');detail.append(body);
      const previewUid='preview-'+artist.id;
      const picker=WorkPicker.mount(body,{uid:previewUid,tag:artist.name,zoom:prefs,order:data.workOrder,orderOptions:WORK_ORDER_OPTIONS,onPreview:work=>previewWork(artist.name,work,previewUid)});activePickers.push(picker);
      ArtistLookup.details(artist.name,'',{previews:false}).then(result=>{if(sequence===lookupSequence)countLine.textContent='作品数量：'+(result.counts.total??'读取失败');}).catch(()=>{if(sequence===lookupSequence)countLine.textContent='作品数量：读取失败';});
      const exists=()=>data.artists.some(a=>a.danbooruId===artist.id||a.name.toLowerCase()===artist.name.toLowerCase());
      const add=btn(exists()?'已在画师库中':'添加此画师',async()=>{
        if(busy||sequence!==lookupSequence)return;
        if(exists()){add.textContent='已在画师库中';add.disabled=true;return;}
        if(data.artists.length>=20000){$('quick-status').textContent='最多支持 20,000 位画师。';return;}
        const chosen=picker.selected();
        if(!chosen.length){$('quick-status').textContent='请先勾选至少一张要保存的作品。';return;}
        add.disabled=true;add.textContent='正在保存预览图…';
        const task=addArtistTail.then(async()=>{
          try{
            /* 轮到自己时先看这次识别是否还有效：上一位添加成功后会作废并清空候选列表，
               此时再往下走只会取一堆图、在磁盘上留下没人认领的目录。 */
            if(sequence!==lookupSequence)return;
            await picker.ready;
            const uid=ArtistId.issue(data.artists,{name:artist.name,danbooruId:artist.id});
            const [saved,quantity]=await Promise.all([cacheWorks(uid,chosen),ArtistLookup.details(artist.name,data.cutoffDate,{previews:false})]);
            if(sequence!==lookupSequence||exists())return;
            await save(next=>{
              if(next.artists.some(a=>a.uid===uid))return next;
              next.artists.push({uid,order:next.artists.length+1,name:artist.name,danbooruId:artist.id,counts:{...quantity.counts},category:null,score:null,aliases:[...artist.aliases],alias:null,tags:[],artistUrl:artist.pageUrl,description:'',note:'',works:saved});
              return next;
            },`已添加 ${artist.name} · ${saved.length} 张预览图`);
            if(sequence===lookupSequence){cancelLookup();$('quick-input').value='';clearCandidates();$('quick-site').hidden=true;$('quick-status').textContent=`已添加 ${artist.name}。可继续输入下一位；如列表被筛选，可按名字搜索。`;$('quick-input').focus();}
          }catch(error){add.disabled=false;add.textContent='添加此画师';$('quick-status').textContent='添加失败：'+error.message;}
        });
        addArtistTail=task.catch(()=>{});
        await task;
      },'action primary-action');add.disabled=exists();picker.tools.append(add);row.append(detail);$('quick-results').append(row);
    }
  }
  async function detectArtist(){    cancelLookup();const sequence=lookupSequence,value=$('quick-input').value.trim();clearCandidates();$('quick-site').hidden=true;
    if(!value){$('quick-status').textContent='输入标签或链接，识别后点击候选画师添加。';return;}
    let p;try{p=ArtistLookup.plan(value);}catch(error){$('quick-status').textContent=error.message;return;}
    $('quick-site').href=p.siteUrl;$('quick-site').hidden=false;
    const cached=lookupCache.get(p.apiUrl);if(cached&&Date.now()-cached.time<600000){showCandidates(cached.results,p,sequence);return;}
    $('quick-status').textContent=p.kind==='url'?'正在根据主页 URL 匹配画师…':'正在查询正式画师标签与别名…';
    const controller=new AbortController();lookupController=controller;const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      let results=await ArtistLookup.lookup(p,{signal:controller.signal});if(sequence!==lookupSequence)return;
      /* 名字类搜索落空时补一次主页地址搜索：像 yotte615 这种只出现在画师主页地址里的字符串，
         按名字、组名、别名都搜不到，只有 url_matches 能命中。 */
      if(!results.length&&p.kind==='name'){
        const byUrl=ArtistLookup.plan(p.input,{match:'url'});
        results=await ArtistLookup.lookup(byUrl,{signal:controller.signal});if(sequence!==lookupSequence)return;
        if(results.length)p=byUrl;
      }
      lookupCache.set(p.apiUrl,{time:Date.now(),results});if(lookupCache.size>100)lookupCache.delete(lookupCache.keys().next().value);showCandidates(results,p,sequence);
    }
    catch(error){if(sequence!==lookupSequence)return;$('quick-status').textContent=error.name==='AbortError'?'查询超时，请重试或打开站内检索。':error instanceof TypeError?'暂时无法跨站读取 Danbooru。请打开站内检索核验，或稍后重试。':error.message;}
    finally{clearTimeout(timeout);}
  }
  function quickChanged(e){
    cancelLookup();clearCandidates();$('quick-site').hidden=true;
    if(e?.isComposing)return;
    const value=$('quick-input').value.trim();$('quick-status').textContent=value?'等待输入完成…':'输入标签或链接，识别后点击候选画师添加。';
    if(value.length>=2||/^\d$/.test(value))lookupTimer=setTimeout(detectArtist,800);
  }
  /* 扩展右键菜单「添加到画师库」：把选中的文字收进库里。
     识别（找正式名、编号、作品）只当成「尽量补全」——认不出来也照样建卡，卡名就用选中的文字，
     资料留给你自己在编辑态里补。右键的意图是「收下这段文字」，不该因为站点上查不到就落空。
     只有三种情况真的不建：没选数据文件夹（写不了盘）、正忙、这位画师已经在库里了。 */
  async function createArtistFromSelection(text){
    const value=String(text||'').replace(/\s+/g,' ').trim().slice(0,200);
    if(!value)return {ok:false,reason:'选中的文字是空的。',text:value};
    if(!folder)return {ok:false,reason:'还没有可用的数据文件夹（可能上次那个搬走了、或权限被拒了）：点提示打开画师库选一次，之后再右键就不用管了。',text:value};
    if(busy||syncingAll)return {ok:false,reason:'画师库正忙（保存或刷新中），过一会儿再右键一次。',text:value};
    /* 先尽量认出这位画师；认不出来就让 chosen 留在 null，下面照建卡。 */
    let chosen=null;
    try{
      let plan=ArtistLookup.plan(value,{match:'name'});
      let found=await ArtistLookup.lookup(plan);
      /* 选中的常常是「tag 编号」「tag（@tag）」这类一整段：整段没匹配上，就再试第一个像标签的词。 */
      if(!found.length&&plan.kind==='name'&&/\s/.test(value)){
        const first=value.split(/\s+/)[0].replace(/^@/,'');
        if(/^[\w-]{2,}$/.test(first)){try{plan=ArtistLookup.plan(first,{match:'name'});found=await ArtistLookup.lookup(plan);}catch{}}
      }
      /* 名字类搜索都落空时，再按主页地址找一次。 */
      if(!found.length&&plan.kind==='name'){
        try{plan=ArtistLookup.plan(value,{match:'url'});found=await ArtistLookup.lookup(plan);}catch{}
      }
      const wanted=String(plan.query||'').toLowerCase(),exact=found.find(item=>item.name.toLowerCase()===wanted);
      chosen=plan.kind==='id'?found[0]:(exact||(found.length===1?found[0]:null));
    }catch{}
    const name=chosen?chosen.name:value;
    const exists=data.artists.find(item=>item.name.toLowerCase()===name.toLowerCase()||(chosen?.id&&item.danbooruId===chosen.id));
    if(exists)return {ok:false,reason:`「${exists.name}」已经在画师库里了`,uid:exists.uid,text:value};
    let works=[];
    if(chosen){try{works=await ArtistLookup.posts(chosen.name,{limit:3,order:data.workOrder});}catch{}}
    try{
      const uid=ArtistId.issue(data.artists,{name,danbooruId:chosen?.id});
      const [saved,quantity]=chosen?await Promise.all([cacheWorks(uid,works),ArtistLookup.details(chosen.name,data.cutoffDate,{previews:false,order:data.workOrder})]):[[],null];
      await save(next=>{
        if(next.artists.some(a=>a.uid===uid))return next;
        next.artists.push({uid,order:next.artists.length+1,name,danbooruId:chosen?.id??null,counts:quantity?{...quantity.counts}:{},category:null,score:null,aliases:chosen?[...chosen.aliases]:[],alias:null,tags:[],artistUrl:chosen?chosen.pageUrl:'https://danbooru.donmai.us/posts?tags='+encodeURIComponent(name),description:'',note:'',works:saved});
        return next;
      },chosen?`右键菜单已添加 ${name} · ${saved.length} 张作品`:`右键菜单已收下「${name}」，资料待补全`);
      return {ok:true,uid,name,danbooruId:chosen?.id??null,works:saved.length,text:value,partial:!chosen};
    }catch(error){return {ok:false,reason:'写入失败：'+error.message,text:value};}
  }
  /* 点漂浮提示回到页面时：清掉筛选、滚到那位画师、闪一下边框。
     页面在后台时滚动是没用的（浏览器不做布局、IntersectionObserver 也不触发），
     所以先记下来，等这一页真的可见了再滚。 */
  let focusPending=null;
  /* 定位只认 uid。没有 uid（排队/失败那朵提示的旧待办）或者那张卡已经不在库里，都只当没这回事：
     绝不退回「识别画师」——那是强制建卡之前的旧流程，会把同一段文字又变成一次手动识别，
     而建卡本来由 create 待办负责，不该在这里再来一遍。 */
  function focusArtist(uid){
    if(!uid)return;
    const artist=data.artists.find(item=>item.uid===uid);
    if(!artist){status('这张卡片已经不在库里了。',true);return;}
    focusPending={uid,name:artist.name};
    applyFocus();
  }
  function applyFocus(){
    if(!focusPending)return;
    if(typeof document!=='undefined'&&document.hidden){status(`切到画师库这一页就会定位到「${focusPending.name}」…`);return;}
    const {uid,name}=focusPending;focusPending=null;
    reset();state.query='';$('search').value='';render();
    ArtistGallery.pin(uid,true);
    const selector='.artist-slot[data-uid="'+((typeof CSS!=='undefined'&&CSS.escape)?CSS.escape(uid):uid)+'"]';
    const slot=document.querySelector(selector);
    ArtistGallery.mount(uid);
    /* 从漂浮提示点回来是「看一眼这位画师」，所以居中而不是顶到固定栏下方。 */
    revealElement(slot,{align:'center'});
    const card=slot?.firstElementChild||slot?.children?.[0];
    if(card?.classList){card.classList.add('is-focus-flash');setTimeout(()=>card.classList.remove('is-focus-flash'),3200);}
    setTimeout(()=>ArtistGallery.pin(uid,false),6000);
    status(`已定位到「${name}」`);
  }
  if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('visibilitychange',()=>{if(!document.hidden)applyFocus();});
  /* 匹配集合：名字 / 笔名 / 别名 / 画风标签。**不含画风描述、备注、序号**——
     站内搜索连这些一起搜，于是搜 dishwasher1910 会被某个人的备注里出现过的词捞走、回一张
     不相干的卡（用户实际遇到的就是「搜 dishwasher1910 却查到 asanagi」）。名字对不上就该去
     Danbooru 找图，而不是硬塞一张别人的卡。
     标签要留在集合里：基础 tag（1girl 这类）本来就不是画师名，用户明确要求支持搜它们。 */
  const normalizeForLookup=value=>String(value||'').trim().replace(/_/g,' ').replace(/\s+/g,' ').toLowerCase();
  const namesForLookup=artist=>[artist.name,artist.alias,...(artist.aliases||[])].filter(Boolean).map(normalizeForLookup);
  const tagsForLookup=artist=>(artist.tags||[]).map(normalizeForLookup);
  async function lookupForPrompt(tag){
    const value=String(tag||'').trim();
    if(!value)return {ok:false,reason:'empty'};
    const wanted=normalizeForLookup(value);
    if(!wanted)return {ok:false,reason:'empty'};
    /* 三档，优先级从高到低：
       ① 名字/笔名/别名/标签**完全相等**——基础 tag（1girl 这类）按这一档命中；
       ② 名字/笔名/别名**包含**查询——页面上双击只能选中 himura，库里存 himura kiseki，
          靠这一档带上 kiseki；
       ③ 标签只认全等，**绝不做子串**：否则搜 girl 会命中某位带 1girl 标签的画师，
          回一张不相干的卡（用户实际遇到的就是「搜 girl 却指向 asanagi」）。 */
    const exact=data.artists.find(artist=>namesForLookup(artist).includes(wanted)||tagsForLookup(artist).includes(wanted));
    const partial=exact||data.artists.find(artist=>namesForLookup(artist).some(name=>name.includes(wanted)));
    const artist=exact||partial;
    if(!artist)return {ok:false,reason:'not-found',value};
    const thumbs=[];
    for(const work of FolderStore.previewWorks(artist,PREVIEW_SLOTS,reservedOf()).filter(Boolean).slice(0,5)){
      try{thumbs.push(await ArtistImages.dataUrl(artist.uid,work,'thumb'));}catch{}
    }
    return {ok:true,value,artist:{uid:artist.uid,name:artist.name,alias:artist.alias||'',category:artist.category||'',score:Number.isSafeInteger(artist.score)?artist.score:null,total:artist.counts?.total??null,beforeTotal:artist.counts?.beforeTotal??null,url:artist.artistUrl||''},thumbs};
  }
  window.ArtistPromptLookup={lookupForPrompt};
  /* 页面自己来找后台要一次待办（右键时页面还没打开的那种），并把建卡结果回传。
     结果同时走两条路：直接回复这次请求，另外再发一条 created 消息——
     万一后台在这期间被回收重启，那条消息能把它叫醒，提示不至于永远停在「正在尝试」。 */
  function bindExtensionMessages(){
    const runtime=typeof chrome!=='undefined'?chrome.runtime:null;
    if(!runtime?.onMessage?.addListener)return;
    const send=payload=>{try{runtime.sendMessage(payload).catch(()=>{});}catch{}};
    runtime.onMessage.addListener((message,sender,respond)=>{
      if(message?.type==='artist-library.create'){
        const done=result=>{
          const report={...result,requestId:message.requestId,sourceTabId:message.sourceTabId};
          try{respond(report);}catch{}
          send({channel:'artist-library-page',type:'created',result:report});
        };
        createArtistFromSelection(message.text).then(done,error=>done({ok:false,reason:'内部错误：'+(error?.message||error),text:message.text}));
        return true;
      }
      if(message?.type==='artist-library.focus'){focusArtist(message.uid);return;}
      /* takoma 提示词助手：按标签查库。只读、不改界面，直接把结果回给后台。 */
      if(message?.type==='artist-library.lookup'){lookupForPrompt(message.tag).then(respond,error=>respond({ok:false,reason:'内部错误：'+(error?.message||error)}));return true;}
    });
    try{
      runtime.sendMessage({channel:'artist-library-page',type:'ready'}).then(answer=>{
        for(const action of answer?.actions||[])handleAction(action,send);
      }).catch(()=>{});
    }catch{}
  }
  /* 待办里的建卡排到「数据文件夹就绪」之后再跑：页面刚被右键菜单打开时，
     文件夹是这一刻才接上的（可能来自记忆、也可能要用户选一次），急不得。 */
  /* 待办里的建卡排进一条串行队列：轮到自己的时候才检查文件夹、才发号。
     这样排队 5 个会一起等文件夹就绪（而不是只有第一个等），序号也不会全撞在 0001。 */
  const createQueue=[];let createRunning=false,createTimer=null;
  function pumpCreate(){
    if(createRunning||!createQueue.length)return;
    if(!folder){
      if(!createTimer){
        status(`右键菜单要添加 ${createQueue.length} 张新卡片：等数据文件夹就绪（可能要点一下「继续使用上次的文件夹」）就依次写入…`);
        /* 给用户足够时间去点那个「继续使用」，超时再重试一次。
           unref：这个等待不该拖着进程不让它退出（node 测试尤其明显）。 */
        createTimer=setTimeout(()=>{createTimer=null;pumpCreate();},60000);
        createTimer?.unref?.();
      }
      return;
    }
    clearTimeout(createTimer);createTimer=null;
    const job=createQueue.shift();createRunning=true;
    const report=result=>job.send({channel:'artist-library-page',type:'created',result:{...result,requestId:job.action.requestId,sourceTabId:job.action.sourceTabId}});
    createArtistFromSelection(job.action.text)
      .then(report)
      .catch(error=>report({ok:false,reason:'内部错误：'+(error?.message||error),text:job.action.text}))
      .finally(()=>{createRunning=false;pumpCreate();});
  }
  function handleAction(action,send){
    if(action?.kind==='create'){createQueue.push({action,send});pumpCreate();return;}
    if(action?.kind==='focus')focusArtist(action.uid);
  }
  /* ---- 生图参数：只存在本机浏览器里，绝不写进画师库数据文件，导出备份也就不会带 token ---- */
  const GEN_LISTS=[['gen-model',()=>ArtistNovelAI.MODELS],['gen-size',()=>ArtistNovelAI.SIZES],['gen-sampler',()=>ArtistNovelAI.SAMPLERS],['gen-uc',()=>ArtistNovelAI.UC_PRESETS]];
  const GEN_FIELDS=[['gen-model','model'],['gen-size','size'],['gen-width','width'],['gen-height','height'],['gen-steps','steps'],['gen-scale','scale'],['gen-cfg-rescale','cfgRescale'],['gen-sampler','sampler'],['gen-seed','seed'],['gen-uc','ucPreset'],['gen-negative','negativePrompt'],['gen-prompt1','prompt1'],['gen-prompt2','prompt2']];
  const GEN_SWITCHES=[['gen-transparent','transparentBg'],['gen-anlas','useAnlas'],['gen-quality','qualityTags']];
  function fillGenSettings(){
    const settings=ArtistImageGen.load();
    for(const [id,key] of GEN_FIELDS)$(id).value=settings[key]==null?'':String(settings[key]);
    for(const [id,key] of GEN_SWITCHES)$(id).checked=settings[key]===true;
    $('gen-token').value=ArtistImageGen.loadToken();
  }
  /* 输入框里是字符串、可能是空、可能超范围：统一交给 sanitize 收口，坏值回落到默认。
     开关按 DOM 给的真假值传，sanitize 那边负责「不是 false 就算开」的默认语义。 */
  function readGenSettings(){const raw={};for(const [id,key] of GEN_FIELDS)raw[key]=$(id).value;for(const [id,key] of GEN_SWITCHES)raw[key]=$(id).checked;return ArtistImageGen.save(raw);}
  function bindGenSettings(){
    for(const [id,list] of GEN_LISTS)$(id).replaceChildren(...list().map(item=>new Option(item.label,item.value)));
    for(const [id] of GEN_FIELDS){const node=$(id);node.onchange=readGenSettings;node.oninput=readGenSettings;}
    for(const [id] of GEN_SWITCHES)$(id).onchange=readGenSettings;
    $('gen-token').oninput=()=>{ArtistImageGen.saveToken($('gen-token').value);showAccount('token 已存到本机，点「刷新额度」重新读取。');};
    $('gen-token-toggle').onclick=()=>{const box=$('gen-token'),hidden=box.type==='password';box.type=hidden?'text':'password';$('gen-token-toggle').textContent=hidden?'隐藏':'显示';};
  }
  const tierName=tier=>tier==='3'||tier===3?'Opus':tier==='2'||tier===2?'Scroll':tier==='1'||tier===1?'Tablet':tier==='0'||tier===0?'Paper':tier==null?'未知套餐':String(tier);
  /* 顶部与对话框里都显示额度。Opus 的张数是按站点客户端的算式（17.3 × 百分比）估出来的，
     所以文案里写「约」，别当成精确值。 */
  function showAccount(message,error=false){
    const node=$('opus-status'),line=$('gen-account'),info=ArtistImageGen.cachedAccount();
    node.classList.toggle('error',error);line.classList.toggle('error',error);
    $('quota-images').textContent=info?.opusImages==null?'约 — 张':'约 '+info.opusImages+' 张';
    $('quota-percent').textContent=info?.opusPercent==null?'—%':info.opusPercent+'%';
    $('quota-points').textContent=info?.anlas==null?'— 点':info.anlas+' 点';
    $('quota-label').textContent=error?'NovelAI · 刷新失败':message?.includes('正在')?'NovelAI · 刷新中':!ArtistImageGen.loadToken()?'NovelAI · 未配置':'NovelAI 额度';
    if(message){line.textContent=message;node.title=message;node.setAttribute('aria-label',message+'，点击刷新 NovelAI 额度');return;}
    if(!info){line.textContent='点「刷新额度」读取剩余张数与 Anlas 点数。';node.title='点击刷新 NovelAI 额度';return;}
    const parts=['套餐 '+tierName(info.tier),'免费额度剩 '+$('quota-images').textContent+'（'+$('quota-percent').textContent+'）','Anlas 点数 '+info.anlas];
    node.title=parts.join('｜')+'（张数为估算值；点击刷新）';node.setAttribute('aria-label',node.title);
    line.textContent=parts.join('｜')+'。张数按站点算式 17.3 × 百分比估算，仅供参考。';
  }
  let accountPending=null;
  function refreshAccount(force){
    if(accountPending)return accountPending;
    if(!ArtistImageGen.loadToken()){showAccount('还没有填写 token，请在生图参数中填写后刷新。');return Promise.resolve(null);}
    showAccount('正在读取 NovelAI 额度…');$('opus-status').setAttribute('aria-busy','true');
    accountPending=(async()=>{
      try{const info=await ArtistImageGen.account({force});showAccount('');return info;}
      catch(error){showAccount('读取额度失败：'+error.message,true);return null;}
      finally{accountPending=null;$('opus-status').setAttribute('aria-busy','false');}
    })();return accountPending;
  }
  /* ---------- 批量生成测试风格图 ----------
     让用户自己划一段画师序号、选几号测试风格，展开成一条条生成需求塞进同一条队列。
     排得比当前额度还多时，先让按钮变红再点一次——一次点掉几百条额度，值得拦一下。 */
  const GEN_BATCH_ARM_MS=8000,GEN_BATCH_MAX_SEQS=20;
  let genBatchArmed=false,genBatchTimer=null;
  const testSeqOf=work=>Number.isSafeInteger(work.testSeq)&&work.testSeq>0?work.testSeq:1;
  /* 「1」→1；「1,2」→1、2；「1-2」→1、2。别的字符当分隔符丢掉。 */
  function parseGenSeqs(text){
    const seqs=new Set();
    for(const part of String(text||'').split(/[^0-9-]+/).filter(Boolean)){
      const range=/^(\d+)-(\d+)$/.exec(part);
      if(range){
        const [from,to]=[Number(range[1]),Number(range[2])].sort((a,b)=>a-b);
        for(let n=Math.max(1,from);n<=Math.min(to,999);n++)seqs.add(n);
      }else{
        const n=Number(part);
        if(Number.isSafeInteger(n)&&n>=1&&n<=999)seqs.add(n);
      }
    }
    return [...seqs].sort((a,b)=>a-b);
  }
  /* 当前额度还允许生成多少张：真要花点数的看 Anlas，否则（免费额度模式，或者参数本来就在免费范围内）
     看 Opus 剩余张数。读不到额度返回 null，交给调用方按「说不准」处理。 */
  function genQuota(){
    const info=ArtistImageGen.cachedAccount();
    if(!info)return null;
    let points=false;
    try{
      const settings=ArtistImageGen.load(),p=ArtistImageGen.bodyFor(settings,1,{name:'x'}).parameters;
      points=settings.useAnlas===true&&ArtistImageGen.needsPoints(p.width,p.height,p.steps);
    }catch{}
    if(points)return {value:info.anlas,text:`当前 Anlas 点数只有 ${info.anlas}`};
    if(info.opusImages==null)return null;
    return {value:info.opusImages,text:`当前 Opus 免费额度只剩约 ${info.opusImages} 张${info.opusPercent==null?'':`（${info.opusPercent}%）`}`};
  }
  const genBatchSkip=()=>$('gen-batch-skip').checked;
  /* 把「序号段 × 测试风格序号」展开成一条条需求。 */
  function genBatchPlan(){
    const raw=Math.max(1,Number($('gen-batch-from').value)||1),from=Math.max(1,raw);
    const to=Math.max(from,Number($('gen-batch-to').value)||from);
    const seqs=parseGenSeqs($('gen-batch-seqs').value),skip=genBatchSkip();
    const matched=data.artists.filter(a=>{const seq=seqOf(a);return Number.isSafeInteger(seq)&&seq>=from&&seq<=to;});
    const jobs=[];let done=0;
    for(const a of matched)for(const seq of seqs){
      if(skip&&(a.works||[]).some(w=>w.kind==='test'&&testSeqOf(w)===seq)){done++;continue;}
      jobs.push({artist:a,seq});
    }
    return {from,to,seqs,matched,jobs,done,quota:genQuota()};
  }
  function disarmGenBatch(){
    clearTimeout(genBatchTimer);genBatchTimer=null;
    if(!genBatchArmed)return;
    genBatchArmed=false;
    const button=$('gen-batch-run');
    button.textContent='排入生成队列';button.classList.remove('is-armed');
  }
  /* 预览：会排多少条、跳过多少、当前额度还剩多少。改任何一个输入都重新算一遍并撤销「确认」状态。 */
  function paintGenBatch(){
    disarmGenBatch();
    const plan=genBatchPlan(),node=$('gen-batch-preview');
    if(!data.artists.length){node.textContent='画师库还是空的，先添加或采集画师。';return;}
    if(!plan.seqs.length){node.textContent='测试风格序号要写成像 1、1,2 或 1-2 这样的数字。';return;}
    if(!plan.matched.length){node.textContent=`序号 ${plan.from} – ${plan.to} 之间没有画师。`;return;}
    const parts=[`将排入 ${plan.jobs.length} 条：${plan.matched.length} 位画师 × ${plan.seqs.length} 个序号（测试风格 ${plan.seqs.join('、')}）`];
    if(plan.done)parts.push(`跳过 ${plan.done} 条已经有这个序号的`);
    parts.push(plan.quota?`额度上限参考：${plan.quota.text}`:'当前额度还没查过，排入前会要求再确认一次');
    node.textContent=parts.join('；')+'。';
  }
  async function runGenBatch(){
    if(busy)return;
    const plan=genBatchPlan(),node=$('gen-batch-preview');
    if(!plan.seqs.length){node.textContent='测试风格序号要写成像 1、1,2 或 1-2 这样的数字。';return;}
    if(plan.seqs.length>GEN_BATCH_MAX_SEQS){node.textContent=`测试风格序号最多 ${GEN_BATCH_MAX_SEQS} 个，现在是 ${plan.seqs.length} 个。`;return;}
    if(!plan.jobs.length){node.textContent='这个范围里没有需要排入的画师（都在范围外，或者都生成过了）。';return;}
    if(!folder){node.textContent='请先选择「数据」文件夹，生成出来的图片要有地方保存。';return;}
    /* 超出额度（或者读不到额度、说不准）就先变红，第二次点才真的排。 */
    const quota=plan.quota,over=!quota||plan.jobs.length>quota.value;
    if(over&&!genBatchArmed){
      genBatchArmed=true;
      const button=$('gen-batch-run');
      button.classList.add('is-armed');button.textContent=`确认排入 ${plan.jobs.length} 条？`;
      node.textContent=quota
        ?`要排入 ${plan.jobs.length} 条，而${quota.text}。超出的那些会失败或要等额度回复，每条都算一次消耗——确认无误请再点一次按钮。`
        :`要排入 ${plan.jobs.length} 条，但现在读不到剩余额度（可以先去「生图参数」点一次「刷新额度」）。确认无误请再点一次按钮。`;
      genBatchTimer=setTimeout(disarmGenBatch,GEN_BATCH_ARM_MS);
      return;
    }
    disarmGenBatch();
    let queued=0,skipped=0;
    /* 几百条是在同一个任务里排完的，中间那些重画没人看得见，先关掉。 */
    enqueueBulk=true;
    try{for(const job of plan.jobs){if(enqueueGenerate(job.artist,job.seq,null,true))queued++;else skipped++;}}
    finally{enqueueBulk=false;}
    paintQueue();render();
    node.textContent=`已排入 ${queued} 条${skipped?`，跳过 ${skipped} 条（已经在队列里）`:''}。`;
    status(`已排入 ${queued} 条生成需求${skipped?`（${skipped} 条已在队列里）`:''}：一条一条跑，两条之间隔 5±3 秒，任务栏的「排队 N」可以取消等待项。`);
    $('gen-batch').close();
  }
  /* 打开时默认就填你当前看到的那一段：采集完切到「待判断」之后，最常见的就是给这批新人生成。 */
  function openGenBatch(){
    const visible=currentRows().filter(a=>Number.isSafeInteger(seqOf(a)));
    const use=visible.length?visible:data.artists.filter(a=>Number.isSafeInteger(seqOf(a)));
    if(use.length){
      const seqs=use.map(seqOf);
      $('gen-batch-from').value=String(Math.min(...seqs));
      $('gen-batch-to').value=String(Math.max(...seqs));
    }
    paintGenBatch();
    $('gen-batch').showModal();
  }
  /* 顶部按钮上的额度：只在已经配好 token 与扩展时自动查一次，其余交给用户点。 */
  function autoAccount(){
    if(!ArtistImageGen.loadToken()){showAccount();return;}
    if(!ArtistExtension.canAccount){showAccount();return;}
    refreshAccount(false);
  }
  async function init(){
    applyCardSize();
    data=normalize(FolderStore.empty());status('请先选择「数据」文件夹，读取或开始整理画师库。');
    $('work-order').replaceChildren(...WORK_ORDERS.map(order=>new Option(WORK_ORDER_LABELS[order],order)));
    $('batch-order').replaceChildren(...WORK_ORDERS.map(order=>new Option(WORK_ORDER_LABELS[order],order)));
    bindGenSettings();
    ArtistTestImages.init({getData:()=>data,getBusy:()=>busy,readImage,thumbnail,save});
    $('test-import-open').onclick=()=>ArtistTestImages.open();$('close-test-import').onclick=()=>$('test-import').close();$('test-cancel').onclick=()=>$('test-import').close();
    $('test-files').onchange=e=>{ArtistTestImages.files=[...e.target.files];ArtistTestImages.refresh();};
    $('test-start').oninput=()=>ArtistTestImages.refresh();$('test-seq').oninput=()=>ArtistTestImages.refresh();$('test-run').onclick=()=>ArtistTestImages.runImport();
    $('test-remove-all').onclick=()=>{for(const box of $('test-remove-list').querySelectorAll('input[type=checkbox]'))box.checked=true;};
    $('test-remove-none').onclick=()=>{for(const box of $('test-remove-list').querySelectorAll('input[type=checkbox]'))box.checked=false;};
    $('test-remove-run').onclick=()=>ArtistTestImages.runRemove();
    $('settings-open').onclick=()=>{$('history-date').value=data.cutoffDate;$('save-large').checked=data.saveLargeImages===true;$('fixed-test').checked=data.fixedTestSlots===true;$('auto-open-works').checked=data.autoOpenWorks===true;$('work-order').value=data.workOrder;$('card-size').value=String(prefs.cardSize);$('card-size-value').textContent=prefs.cardSize;$('card-size-compact').value=String(prefs.cardSizeCompact);$('card-size-compact-value').textContent=prefs.cardSizeCompact;$('settings').showModal();};$('close-settings').onclick=()=>$('settings').close();
    $('gen-settings-open').onclick=()=>{fillGenSettings();showAccount();updateGenStatus();$('gen-settings').showModal();if(ArtistImageGen.loadToken()&&!ArtistImageGen.cachedAccount())refreshAccount(false);};$('close-gen-settings').onclick=()=>$('gen-settings').close();
    $('opus-status').onclick=()=>refreshAccount(true);
    $('gen-queue').onclick=()=>{const dropped=genQueue.clear();status(dropped?`已取消排队的 ${dropped} 条生成需求；正在跑的那条会跑完。`:'队列里没有等待中的需求。');};paintQueue();
    $('gen-batch-open').onclick=openGenBatch;$('close-gen-batch').onclick=()=>$('gen-batch').close();$('gen-batch').addEventListener('close',disarmGenBatch);
    $('gen-batch-run').onclick=runGenBatch;
    for(const id of ['gen-batch-from','gen-batch-to','gen-batch-seqs'])$(id).oninput=paintGenBatch;
    $('gen-batch-skip').onchange=paintGenBatch;
    $('gen-account-refresh').onclick=()=>refreshAccount(true);
    $('card-size').oninput=()=>{const value=Number($('card-size').value);$('card-size-value').textContent=value;prefs.setCardSize(value);};
    $('card-size-compact').oninput=()=>{const value=Number($('card-size-compact').value);$('card-size-compact-value').textContent=value;prefs.setCardSizeCompact(value);};
    $('save-large').onchange=async()=>{const next=clone(data);next.saveLargeImages=$('save-large').checked;await save(next,next.saveLargeImages?'已开启「保存大图」：预览作品时会保存原图':'已关闭「保存大图」：预览作品时不再保存原图');};
    $('fixed-test').onchange=async()=>{const next=clone(data);next.fixedTestSlots=$('fixed-test').checked;await save(next,next.fixedTestSlots?'已开启「固定测试风格图」：每张卡片右侧 2 格留给测试风格 1、2':'已关闭「固定测试风格图」：测试风格图不再占固定格子');};
    $('auto-open-works').onchange=async()=>{const next=clone(data),on=$('auto-open-works').checked;next.autoOpenWorks=on;await save(next,on?'已开启「编辑画师时自动展开 danbooru 作品」：进入编辑态就会按名字读取站点作品':'已关闭「编辑画师时自动展开 danbooru 作品」：需要时自己点「展开读取」');};
    $('gen-check').onclick=()=>checkExtension();
    $('history-date').onchange=async()=>{const date=$('history-date').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ $('history-date').value=data.cutoffDate;return;}const next=clone(data);next.cutoffDate=date;await save(next,'已保存截至日期；下次保存画师时会按新日期更新该画师的数量。');};
    $('work-order').onchange=async()=>{const value=$('work-order').value;if(!WORK_ORDERS.includes(value)){ $('work-order').value=data.workOrder;return;}const next=clone(data);next.workOrder=value;await save(next,'已改为按「'+WORK_ORDER_LABELS[value]+'」采集作品');};
    $('add-artist').onclick=()=>startEdit(null);$('quick-form').onsubmit=e=>{e.preventDefault();detectArtist();};$('quick-input').oninput=quickChanged;$('quick-input').addEventListener('compositionend',quickChanged);bindExtensionMessages();
    $('quick-manual').onclick=()=>{cancelLookup();startEdit(null);const value=$('quick-input').value.trim();if(value&&draft){try{const p=ArtistLookup.plan(value);if(p.kind==='name')draft.name=p.query;else if(p.kind==='url')draft.artistUrl=p.query;editorRevision++;render();}catch{}}};
    $('manage-tags').onclick=()=>{if(!busy){manageFilter.category='';manageFilter.tag='';$('category-search').value='';$('tag-search').value='';showManageTab('category');listCategories();listTags();$('tag-manager').showModal();}};$('close-tags').onclick=()=>$('tag-manager').close();
    $('tab-category').onclick=()=>showManageTab('category');$('tab-tag').onclick=()=>showManageTab('tag');
    $('sync-all').onclick=()=>{if(syncingAll){syncAllStop=true;return null;}return syncAllArtists();};
    $('category-search').oninput=e=>{manageFilter.category=e.target.value.trim().toLowerCase();listCategories();};
    $('tag-search').oninput=e=>{manageFilter.tag=e.target.value.trim().toLowerCase();listTags();};
    $('category-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const name=$('new-category').value.trim();if(!name)return;if(data.categories.includes(name)){alert('这个分类已存在。');return;}const next=clone(data);next.categories.push(name);await save(next);$('new-category').value='';listCategories();};$('tag-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const t=$('new-tag').value.trim();if(!t)return;if(data.tags.includes(t)){alert('这个标签已存在。');return;}const next=clone(data);next.tags.push(t);await save(next);$('new-tag').value='';listTags();};
    $('batch-artists').onclick=()=>{if(busy&&!batchRunning)return;/* 采集还在跑时只是把对话框收起来，别把进度和名单抹掉 */if(!batchRunning){$('batch-names').value='';$('batch-message').textContent='';$('batch-order').value=data.workOrder;disarmBatch();}$('batch-dialog').showModal();};$('close-batch').onclick=()=>$('batch-dialog').close();/* 收起 ≠ 取消：采集继续跑，要停请点「停止采集」 */$('batch-dialog').addEventListener('close',()=>disarmBatch());$('batch-stop').onclick=$('batch-stop-dialog').onclick=()=>{if(!batchRunning)return;batchStop=true;status('正在停止采集：当前这一位采集完就停，已经采集到的会保留。');};$('batch-form').onsubmit=batch;$('names-file').onchange=async e=>{try{const f=e.target.files[0];if(f){if(f.size>5*1024*1024)throw Error('TXT 名单不能超过 5 MB。');$('batch-names').value=await f.text();}}catch(error){$('batch-message').textContent=error.message;}finally{e.target.value='';}};
    $('export-data').onclick=exportData;$('import-data').onclick=()=>{if(!busy)$('import-file').click();};$('import-file').onchange=importData;
    let searchTimer;
    const searchChanged=e=>{if(e.isComposing)return;state.query=e.target.value.trim().toLowerCase();clearTimeout(searchTimer);searchTimer=setTimeout(render,120);};
    $('search').oninput=searchChanged;$('search').addEventListener('compositionend',searchChanged);
    $('library-sort').onchange=()=>{state.sort=$('library-sort').value;render();};
    $('sort-direction').onclick=()=>{state.desc=!state.desc;paintSortDirection();render();};
    paintSortDirection();
    $('reset').onclick=()=>{reset();render();};$('close-viewer').onclick=()=>$('viewer').close();
    ArtistViewer.init({getData:()=>data,getFolder:()=>folder,save,notify:status});
    $('viewer').addEventListener('close',()=>ArtistViewer.dispose());$('save-original').onclick=()=>ArtistViewer.saveOriginal();
    // 遮罩点击、键盘导航与导航焦点交由工作台统一处理。
    $('extension-status').onclick=checkExtension;
    /* 图片拖到格子以外的地方时，浏览器默认会直接打开那个文件、把当前页面顶掉（没保存的改动就没了）。
       在窗口这一层兜住：整页都不接受文件拖放，只有格子上的处理器会把事件拿走。 */
    window.addEventListener('dragover',event=>event.preventDefault());
    window.addEventListener('drop',event=>event.preventDefault());
    window.addEventListener('beforeunload',e=>{if(volatile||busy||generating||syncingAll||batchRunning||!genQueue.idle){e.preventDefault();e.returnValue='';}});render();document.querySelectorAll('button,input,textarea,select').forEach(b=>b.disabled=true);$('choose-folder').disabled=false;$('extension-status').disabled=false;$('choose-folder').onclick=connectFolder;window.ArtistWorkspace?.init({saveEditor:()=>{if(!busy&&!uploading&&draft)saveDraft();}});checkExtension().then(autoAccount);restoreFolder();
  }
  init();
})();
