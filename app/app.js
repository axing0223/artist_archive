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
  const state={category:'全部',tags:new Set(),scores:new Set(),query:''};
  const PREF_KEY='artist-library.thumb-height',PREF_CARD='artist-library.card-size';
  const savePref=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};
  const applyCardSize=value=>document.documentElement.style.setProperty('--card-size',(value||prefs.cardSize)+'px');
  const prefs={thumbHeight:120,cardSize:220,listeners:new Set(),
    setThumbHeight(value){this.thumbHeight=value;savePref(PREF_KEY,value);for(const fn of this.listeners)fn(value);},
    setCardSize(value){this.cardSize=value;savePref(PREF_CARD,value);applyCardSize(value);},
    subscribe(fn){this.listeners.add(fn);},unsubscribe(fn){this.listeners.delete(fn);}};
  try{
    const stored=Number(localStorage.getItem(PREF_KEY));if(Number.isFinite(stored)&&stored>=70&&stored<=220)prefs.thumbHeight=stored;
    const card=Number(localStorage.getItem(PREF_CARD));if(Number.isFinite(card)&&card>=140&&card<=360)prefs.cardSize=card;
  }catch{}
  let data,folder,draft,editingId,busy=false,uploading=false,volatile=false,refreshTimer=null,generating=false;
  /* 生图排队：一次只跑一条，两条之间隔 5±3 秒，避免一口气打过去被站点限流。
     排了长队就得能喊停，所以顶部有一个「排队 N · 清空」，只在真的有人排队时才出现。 */
  const genQueue=ArtistGenerateQueue.create({gap:()=>ArtistImageGen.genGapDelay(),onChange:paintQueue});
  function paintQueue(){
    const node=$('gen-queue'),count=genQueue.pending;
    node.hidden=count===0;
    node.textContent=count?`排队 ${count} · 清空`:'排队 0';
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
    return {version:1,categories:categoryList,cutoffDate:/^\d{4}-\d{2}-\d{2}$/.test(raw.cutoffDate)?raw.cutoffDate:'2026-07-01',saveLargeImages:raw.saveLargeImages===true,fixedTestSlots:raw.fixedTestSlots===true,workOrder:WORK_ORDERS.includes(raw.workOrder)?raw.workOrder:DEFAULT_WORK_ORDER,date:text(raw.date,40),method:text(raw.method,12000),tags:unique([...(Array.isArray(raw.tags)?raw.tags:defaults),...artists.flatMap(a=>a.tags)]).map(t=>t.slice(0,40)),artists};
  }
  function status(t,error=false){$('storage-status').textContent=t;$('storage-status').classList.toggle('error',error);}
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
  async function write(value){if(!folder)throw Error('请先选择数据文件夹');return normalize(await FolderStore.write(folder,value));}
  /* 真正把一个目录句柄接上：不管是刚选的还是从记忆里取回来的，都走这里。 */
  async function adoptFolder(chosen,{from='刚选择',remember=true}={}){
    status('正在读取画师资料（图片按需加载）…');
    const loaded=normalize(await FolderStore.read(chosen),true);
    cancelLookup();clearCandidates();
    folder=chosen;data=loaded;FolderStore.remember(chosen,loaded);ArtistImages.setFolder(chosen);
    reset();render();
    document.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=false);
    $('folder-name').textContent='当前文件夹：'+folder.name;
    $('resume-folder').hidden=true;
    /* 记住这个文件夹，下次打开网页直接接着用；记不住（环境不支持）就如实说一声。 */
    const kept=remember?await ArtistFolderMemory.save(chosen):true;
    const warnings=FolderStore.takeWarnings(),tail=kept?'':'；这个环境记不住文件夹，下次还得重新选';
    status(warnings.length?`已连接文件夹（${from}），但有 ${warnings.length} 处问题：${warnings.join('；')}${tail}`:`已连接文件夹（${from}） · 图片滚动到附近才加载${tail}`,warnings.length>0);
    /* 文件夹一就绪，就把右键菜单排队等着的那张卡建出来 */
    if(queuedCreate)runQueuedCreate();
  }
  async function connectFolder(){
    if(busy)return;
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
      catch(error){status('上次的数据文件夹打不开：'+error.message+'；请点顶部「数据库文件夹」重新选择。',true);}
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
        else{await ArtistFolderMemory.forget();button.hidden=true;status('没有继续使用上次的文件夹，请点顶部「数据库文件夹」重新选择。',true);}
      }catch(error){button.hidden=true;status('继续使用上次的文件夹失败：'+error.message+'；请重新选择。',true);}
      finally{button.disabled=false;}
    };
    status(`记得你上次用的是「${name}」：点右边按钮继续用它，或点顶部「数据库文件夹」换一个。`);
  }
  async function save(next,message='已保存到数据文件夹'){
    busy=true;data=next;status('正在保存…');
    const controls=[...document.querySelectorAll('button,input,textarea,select')].map(e=>[e,e.disabled]);controls.forEach(([e])=>e.disabled=true);
    try{data=await write(data);volatile=false;const warnings=FolderStore.takeWarnings();status(warnings.length?message+'；'+warnings.join('；'):message,warnings.length>0);}catch(error){volatile=true;status('文件保存失败：'+error.message+'；修改暂留本页，请导出备份。',true);}finally{controls.forEach(([e,disabled])=>e.disabled=disabled);busy=false;render();}
  }
  function reset(){state.category='全部';state.tags.clear();state.scores.clear();state.query='';$('search').value='';}
  function showImage(a,w){ArtistViewer.open({title:a.name,uid:a.uid,work:w,caption:w.caption,persist:true});}
  /* 一格作品：图 + 左下角说明 + 右下角删除。 */
  function workFigure(a,w,slot){
    const figure=el('figure','work'),open=btn('',()=>showImage(a,w),'thumb'),img=el('img');
    if(w.kind==='test')figure.classList.add('is-test');
    open.setAttribute('aria-label',`查看 ${a.name} 的${w.kind==='test'?'测试风格图片':'作品 '+(slot+1)}`);
    img.alt=a.name+' 的作品';ArtistImages.bind(img,a.uid,w,'card:'+a.uid,'thumb');open.append(img);
    const caption=el('figcaption');caption.append(slotLabel(a,w,slot),deleteSlotButton(a,w));
    figure.append(open,caption);
    return figure;
  }
  /* 左下角：有 Danbooru 编号就做成可点的 #编号，点开对应作品页；测试风格图只写序号，不给链接。 */
  function slotLabel(a,w,slot){
    if(w.kind==='test')return el('span','',`测试风格 ${w.testSeq||1}`);
    const id=String(w.id||'').trim(),href=url(w.url)||(id?`https://danbooru.donmai.us/posts/${encodeURIComponent(id)}`:'');
    if(id&&href){const node=link('#'+id,href,'work-id');node.title='在 Danbooru 打开这件作品';return node;}
    if(href)return link('来源 ↗',href,'work-id');
    return el('span','',w.id?'#'+w.id:'作品 '+(slot+1));
  }
  const deleteSlotButton=(a,w)=>confirmButton('删除','再点一次删除',()=>deleteSlotWork(a,w),'slot-delete');
  async function deleteSlotWork(a,w){
    const index=Array.isArray(a.works)?a.works.indexOf(w):-1;
    if(index<0){status('这一格已经不在库里了。',true);return;}
    const isTest=w.kind==='test',what=isTest?`测试风格 ${w.testSeq||1}`:`作品 #${w.id||index+1}`;
    const next=clone(data),target=next.artists.find(item=>item.uid===a.uid);
    if(!target||!target.works[index]){status('这一格已经不在库里了。',true);return;}
    target.works.splice(index,1);
    await save(next,`已删除「${a.name}」的${what}`);
  }
  /* 外部拖图进来：落到哪一格就换成哪一格（测试格按该格的序号，作品格换掉那一格）。 */
  function attachDrop(node,a,index){
    const mark=on=>node.classList.toggle('is-drop-target',on);
    node.addEventListener('dragover',event=>{if(!event.dataTransfer)return;event.preventDefault();event.dataTransfer.dropEffect='copy';mark(true);});
    node.addEventListener('dragleave',()=>mark(false));
    node.addEventListener('drop',event=>{mark(false);const files=[...(event.dataTransfer?.files||[])];if(!files.length)return;event.preventDefault();dropImages(a,index,files);});
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
      const next=clone(data),target=next.artists.find(item=>item.uid===a.uid);
      if(!target)throw Error('这位画师已经不在库里了。');
      target.works=FolderStore.placeWork(target,index,added,{limit:PREVIEW_SLOTS,reserve:reservedOf()});
      await save(next,`已把 ${added.length} 张图片放进「${a.name}」从第 ${index+1} 格起的位置${skipped.length?`；跳过 ${skipped.length} 个不支持的文件：${skipped.slice(0,3).join('、')}`:''}`);
    }catch(error){status('拖入失败：'+error.message,true);}
    finally{uploading=false;}
  }
  /* 空着的固定格：一个「生成」按钮，外加它对应的测试风格序号。
     按钮自己承担二次确认（第一次点亮、第二次才真发），不再弹系统对话框。 */
  function generateSlot(a,seq){
    const box=el('div','work work-generate'),label=el('span','generate-seq','测试风格 '+seq),button=btn('生成',()=>armGenerate(a,seq,{box,button,label}),'generate-button');
    button.title=`用 NovelAI 生成「测试风格 ${seq}」并回填到这一格`;
    box.append(button,label);
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
  /* 排队：一次只跑一条，两条之间隔 5±3 秒。第二条起都是先入队再等，第一条立刻发。 */
  function enqueueGenerate(a,seq,slot){
    if(busy||!a)return false;
    if(!folder){disarmSlot();status('请先选择「数据」文件夹，生成出来的图片要有地方保存。',true);return false;}
    const uid=a.uid;
    if(genQueue.has(item=>item.uid===uid&&item.seq===seq)){status(`「${a.name}」的测试风格 ${seq} 已经在排队了。`,true);return false;}
    const box=liveBox(slot?.box);
    queuedMark(box,genQueue.pending+1);
    const place=genQueue.push({
      uid,seq,
      run:()=>runGenerateJob({uid,seq,box}),
      onError:error=>status('生成失败：'+error.message,true),
    });
    if(place>1)status(`已排入队列：第 ${place} 位，「${a.name}」测试风格 ${seq}。`);
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
      /* 缩略图算完再取快照，之后到落盘之间不再有等待，免得和别的保存互相覆盖。 */
      const next=clone(data),into=next.artists.find(item=>item.uid===uid);
      if(!into)throw Error('这位画师已经不在库里了，图片没有保存。');
      const testSeq=FolderStore.nextTestSeq(into.works,seq);
      /* 生成时用了什么提示词一并记下来：以后要复现或对比，不用去猜。 */
      into.works.push({id:'',url:'',caption:prompt,kind:'test',testSeq,thumb,large:original,thumbUrl:null,largeUrl:null});
      await save(next,`已为「${name}」生成测试风格 ${testSeq}（${width} × ${height} · ${steps} 步${free?' · 未用点数':''}）`);
      const after=await refreshAccount(true);
      if(after&&before&&!free&&after.anlas<before.anlas)status(`已生成测试风格 ${testSeq}；这次消耗了 ${before.anlas-after.anlas} 点 Anlas，剩余 ${after.anlas} 点。`);
    }catch(error){
      status('生成失败：'+error.message,true);
      if(box){box.classList.remove('is-generating');box.replaceChildren(...previous);unqueuedMark(box);}
    }finally{generating=false;}
  }
  function artistCard(a){
    const article=el('article','artist'),info=el('div','artist-info'),top=el('div','artist-top');article.dataset.artist=a.name;
    const numbers=el('div','artist-numbers'),countLabel=el('span','work-count','作品数量：'+(a.counts?.total??'未读取')+'（'+(a.counts?.beforeTotal??'未读取')+'）');
    countLabel.title=a.counts?.beforeDate?'括号内数量使用的截至日期：'+a.counts.beforeDate+(a.counts.beforeDate!==data.cutoffDate?'；设置已变更，点击刷新后更新。':''):'括号内为截至日期数量，点击刷新读取。';
    numbers.append(el('span','serial',String(seqOf(a)).padStart(4,'0')),countLabel);top.append(numbers);
    const heading=el('h2'),nameButton=el('button','artist-name',a.name);nameButton.type='button';nameButton.title='点击复制画师 tag';
    nameButton.onclick=()=>copyText(a.name,'画师 tag');heading.append(nameButton);info.append(top,heading);
    if(a.alias)info.append(el('span','alias',a.alias));
    if(a.basis)info.append(el('span','basis',a.basis));
    if(a.description)info.append(el('p','description',a.description));
    const meta=el('div','artist-meta');meta.append(el('span',a.category?'primary':'pending-badge',a.category||'待判断'));
    if(a.tags.length){const ts=el('div','secondary');a.tags.forEach(t=>ts.append(el('span','',t)));meta.append(ts);}
    const actions=el('div','artist-actions');actions.append(btn('编辑',()=>startEdit(a),'edit-button'));if(a.artistUrl)actions.append(link('画师页面 ↗',a.artistUrl,'edit-button'));info.append(actions);
    const works=el('div','works');if(!a.works.length){const empty=el('div','unavailable');empty.append(el('strong','',a.status||'还没有作品图片'),el('span','',a.note||'编辑画师，上传你想参考的作品。'));works.append(empty);}
    const reserve=reservedOf(),slots=FolderStore.previewWorks(a,PREVIEW_SLOTS,reserve);
    slots.forEach((w,i)=>{
      /* 固定格空着的时候给一个「生成」入口：点了就用设置里的生图参数向 NovelAI 要一张测试风格图。 */
      const node=w?workFigure(a,w,i):(i>=PREVIEW_SLOTS-reserve?generateSlot(a,PREVIEW_SLOTS-i):el('div','work work-empty'));
      attachDrop(node,a,i);works.append(node);
    });
    if(a.note)works.append(el('p','sample-note',a.note));
    article.append(info,works,meta);
    if(Number.isSafeInteger(a.score)&&a.score>=1&&a.score<=5)article.append(el('span','score-badge score-'+a.score,String(a.score)));
    return article;
  }
  /* 认草稿有两种情况：新建时 rows 里放的就是 draft 本身；编辑已有画师时按 editingId 认，
     不能按 draft.uid——刷新同步到正式名之后 draft.uid 会和库里存的那条不一样。 */
  function card(a){return draft&&(a===draft||(editingId&&a.uid===editingId))?editingCard(a):artistCard(a);}
  function editingCard(a){
    const article=el('article','artist is-editing'),info=el('div','artist-info');
    const numbers=el('div','artist-numbers');numbers.append(el('span','serial',String(seqOf(draft)).padStart(4,'0')),el('span','work-count',draft.works.length+' 张图片'));info.append(numbers);
    const field=(label,node)=>{const wrap=el('label','edit-field');wrap.append(el('span','edit-label',label),node);return wrap;};
    const fieldBox=(label,node)=>{const wrap=el('div','edit-field edit-field-wide');wrap.append(el('span','edit-label',label),node);return wrap;};
    const nameInput=el('input');nameInput.value=draft.name;nameInput.maxLength=160;nameInput.placeholder='画师名字（必填）';nameInput.oninput=()=>{
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
    editorError=el('p','error');info.append(grid,field('画风描述',descInput),field('备注',noteInput),editorError);
    const actions=el('div','artist-actions');actions.append(btn('保存',saveDraft,'action primary-action'),btn('取消',cancelEdit,'action'),btn('刷新',refreshCurrentArtist,'action'));
    const remove=removeButton();if(!editingId)remove.hidden=true;actions.append(remove);info.append(actions);
    const works=el('div','works');
    draft.works.forEach((w,i)=>{const figure=el('figure','work'),thumb=btn('',()=>showImage({uid:draft.uid,name:draft.name},w),'thumb'),img=el('img');if(w.kind==='test')figure.classList.add('is-test');img.alt=draft.name+' 的作品';ArtistImages.bind(img,draft.uid,w,'editor','thumb');thumb.append(img);const caption=el('figcaption');caption.append(el('span','',w.kind==='test'?`测试风格 ${w.testSeq||1}`:'作品 '+(i+1)));caption.append(btn('移除',()=>{draft.works.splice(i,1);render();},'danger-link'));figure.append(thumb,caption);works.append(figure);});
    const uploadLabel=el('label','action upload-label','＋ 上传本地图片'),uploadInput=el('input');uploadInput.type='file';uploadInput.accept='image/jpeg,image/png,image/webp,image/gif,image/avif';uploadInput.multiple=true;uploadInput.hidden=true;uploadInput.onchange=upload;uploadLabel.append(uploadInput);
    works.append(el('p','sample-note',`共 ${draft.works.length} 张图片 · 可单独移除；保存后才会写入画师目录`));
    const expand=el('section','artist-expand'),head=el('div','expand-head');head.append(el('strong','','从 Danbooru 添加作品'),btn('展开读取',()=>togglePicker(expand),'action'),uploadLabel);expand.append(head);
    article.append(info,works,expand);return article;
  }
  function render(){
    $('history-date').value=data.cutoffDate;
    $('save-large').checked=data.saveLargeImages===true;
    $('work-order').value=data.workOrder;
    /* 分类计数一趟走完：原来是每个分类各过滤一遍全部画师，八个分类就是八趟。 */
    const counts=new Map([['全部',data.artists.length],['待判断',0]]);for(const c of data.categories)counts.set(c,0);
    for(const a of data.artists){if(a.category&&counts.has(a.category))counts.set(a.category,counts.get(a.category)+1);else if(!a.category)counts.set('待判断',counts.get('待判断')+1);}
    $('categories').replaceChildren(...['全部',...data.categories,'待判断'].map(c=>{const b=btn(c,()=>{state.category=c;render();},c===state.category?'active':'');b.setAttribute('aria-pressed',String(c===state.category));b.append(el('span','n',counts.get(c)||0));return b;}));
    $('tags').replaceChildren(...data.tags.map(t=>{const b=btn(t,()=>{state.tags.has(t)?state.tags.delete(t):state.tags.add(t);render();},state.tags.has(t)?'active':'');b.setAttribute('aria-pressed',String(state.tags.has(t)));return b;}));
    /* 分数精确匹配、可多选；0 代表未评分 */
    const toggleScore=value=>{state.scores.has(value)?state.scores.delete(value):state.scores.add(value);render();};
    $('scores').replaceChildren(...[1,2,3,4,5].map(n=>{
      const on=state.scores.has(n),b=btn(String(n),()=>toggleScore(n),`score-pick score-${n}${on?' active':''}`);
      b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',n+' 分');b.title=n+' 分';return b;
    }),(()=>{const on=state.scores.has(0),b=btn('未评分',()=>toggleScore(0),`score-any${on?' active':''}`);b.setAttribute('aria-pressed',String(on));return b;})());
    const activeTags=[...state.tags];
    const rows=data.artists.filter(a=>(state.category==='全部'||(state.category==='待判断'?!a.category:a.category===state.category))&&activeTags.every(t=>a.tags.includes(t))&&(state.scores.size===0||state.scores.has(a.score||0))&&a.name.toLowerCase().includes(state.query));
    if(draft&&!editingId)rows.push(draft);
    const gallery=$('gallery');gallery.classList.add('is-refreshing');ArtistGallery.render(gallery,rows,card);clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>gallery.classList.remove('is-refreshing'),260);
    $('count').textContent=`找到 ${rows.length} / ${data.artists.length} 位 · 连续滚动，按需加载${state.tags.size>1?' · 同时包含所选标签':''}`;$('empty').hidden=rows.length!==0;
    $('library-summary').textContent=`${data.artists.length} 位画师 · ${data.artists.reduce((n,a)=>n+a.works.length,0)} 张作品 · 由你自由整理`;$('sample-date').textContent=data.date?'初始样本日期：'+data.date:'';
  }
  let editorPicker=null,editorHost=null,editorError=null;
  function setEditorError(message){if(editorError)editorError.textContent=message;}
  /* 收起要把容器本身从页面移除：dispose() 已经清空了它的内容，只清内容会留下一个空壳。 */
  function closeWorkPicker(){if(editorPicker){editorPicker.dispose();editorPicker=null;}if(editorHost){editorHost.remove?.();editorHost=null;}}
  function togglePicker(expand){
    if(editorPicker){closeWorkPicker();return;}
    const tag=(draft.name||'').trim();
    if(!tag){setEditorError('先在「画师名字」里填 Danbooru 标签，再用它去找作品。');return;}
    setEditorError('');
    editorHost=el('div','work-picker');expand.append(editorHost);
    const exclude=new Set(draft.works.map(w=>w.id).filter(Boolean));
    editorPicker=WorkPicker.mount(editorHost,{uid:draft.uid,tag,exclude,zoom:prefs,order:data.workOrder,orderOptions:WORK_ORDER_OPTIONS,onPreview:work=>previewWork(draft.name,work,draft.uid)});
    const action=btn('添加所选到作品列表',async()=>{
      const chosen=editorPicker.selected();
      if(!chosen.length){setEditorError('请先勾选要添加的作品。');return;}
      action.disabled=true;action.textContent='正在下载缩略图…';
      try{const saved=await cacheWorks(draft.uid,chosen);draft.works.push(...saved);closeWorkPicker();render();focusEditingCard();}
      catch(error){setEditorError('添加失败：'+error.message);}
      finally{action.disabled=false;action.textContent='添加所选到作品列表';}
    },'action primary-action'),bar=el('div','picker-actions');
    bar.append(action,btn('收起',()=>{closeWorkPicker();focusEditingCard();}));editorHost.append(bar);
    focusEditingCard();
  }
  function focusEditingCard(){
    if(!draft)return;
    const uid=editingId||draft.uid,find=()=>document.querySelector('.artist-slot[data-uid="'+uid+'"]');
    requestAnimationFrame(()=>{
      ArtistGallery.mount(uid);
      const slot=find();if(!slot)return;
      slot.scrollIntoView({block:'center',behavior:'smooth'});
      /* 平滑滚动期间上下方的卡片会按需挂载与释放，文档高度一直在变，目标位置会跟着漂。
         等滚动结束再校验一次：已经对齐就不动它，偏了才瞬时补齐，不叠第二层动画。 */
      setTimeout(()=>{
        const now=find();if(!now)return;
        const rect=now.getBoundingClientRect(),drift=rect.top+rect.height/2-window.innerHeight/2;
        if(Math.abs(drift)>8)now.scrollIntoView({block:'center',behavior:'auto'});
      },420);
    });
  }
  function morphAway(uid,then){
    const article=uid?document.querySelector('.artist-slot[data-uid="'+uid+'"] article'):null;
    if(!article){then();return;}
    article.classList.add('is-morphing');
    setTimeout(then,130);
  }
  function startEdit(a){
    if(busy)return;
    const previous=editingId;
    closeEditor();
    editingId=a?.uid||null;
    draft=a?clone(a):{uid:uid(),name:'',category:null,score:null,aliases:[],alias:null,tags:[],artistUrl:'',description:'',note:'',works:[]};
    if(editingId)ArtistGallery.pin(editingId,true);
    morphAway(previous||editingId,()=>{render();focusEditingCard();});
  }
  function cancelEdit(){
    if(busy||uploading)return;
    morphAway(editingId,()=>{closeEditor();render();});
  }
  function closeEditor(){if(editingId)ArtistGallery.pin(editingId,false);closeWorkPicker();editingId=null;draft=null;editorError=null;}
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
  async function refreshCounts(artist){
    const result=await ArtistLookup.details(artist.name,data.cutoffDate,{previews:false});
    const counts={...(artist.counts||{})};
    if(result.counts.total!==null){counts.total=result.counts.total;counts.checkedAt=result.counts.checkedAt;}
    if(result.counts.beforeTotal!==null){counts.beforeTotal=result.counts.beforeTotal;counts.beforeDate=data.cutoffDate;}
    return {counts,partial:result.countsError};
  }
  const SYNC_CHUNK=25,SYNC_CONCURRENCY=3;
  let syncingAll=false,syncAllStop=false;
  /* 全库刷新：每位画师都重新核对站点上的正式名，并刷新作品数量。按批写盘，
     中途停下来时已经刷好的部分已经落盘，不会白跑。 */
  async function syncAllArtists(){
    if(busy||syncingAll)return;
    const targets=data.artists.map(a=>({uid:a.uid,name:a.name}));
    if(!targets.length){status('画师库还是空的，先添加画师。',true);return;}
    const button=$('sync-all');
    let done=0,renamed=0,skipped=0,failed=0;
    const paint=()=>{button.textContent=`停止刷新（${done} / ${targets.length}）`;};
    syncingAll=true;syncAllStop=false;
    button.classList.add('danger');button.classList.add('is-armed');paint();
    try{
      for(let i=0;i<targets.length;i+=SYNC_CHUNK){
        if(syncAllStop)break;
        const slice=targets.slice(i,i+SYNC_CHUNK),next=clone(data);
        /* 重名检查与登记在同一段同步代码里完成，几个并发之间不会同时放行同一个新名字 */
        const takenNames=new Set(next.artists.map(a=>a.name.toLowerCase()));
        let cursor=0;
        await Promise.all(Array.from({length:Math.min(SYNC_CONCURRENCY,slice.length)},async()=>{
          while(cursor<slice.length&&!syncAllStop){
            const item=slice[cursor++],target=next.artists.find(a=>a.uid===item.uid);
            if(!target)continue;
            try{
              const [hit,counts]=await Promise.all([lookupArtist(item.name),refreshCounts({...target,name:item.name})]);
              if(counts)target.counts=counts.counts;
              const canonical=hit&&hit.canonical;
              if(!canonical||canonical===target.name)skipped++;
              else if(takenNames.has(canonical.toLowerCase()))skipped++;
              else{
                takenNames.delete(target.name.toLowerCase());takenNames.add(canonical.toLowerCase());
                reidentify(target,canonical,hit.id);
                target.name=canonical;
                if(hit.id!=null)target.danbooruId=hit.id;
                if(hit.aliases.length)target.aliases=hit.aliases;
                renamed++;
              }
            }catch{failed++;}
            done++;paint();
          }
        }));
        await save(next,`正在刷新画师数据 ${done} / ${targets.length}…`);
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
    render();
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
    if(editingId){
      const seq=ArtistId.parse(draft.uid)?.seq;
      const uid=seq?ArtistId.create({seq,name:draft.name,danbooruId:Number.isSafeInteger(draft.danbooruId)?draft.danbooruId:null}):draft.uid;
      if(uid!==draft.uid)reidentify(draft,draft.name,draft.danbooruId);
    }
    const next=clone(data),i=next.artists.findIndex(a=>a.uid===editingId);
    if(i<0){draft.uid=ArtistId.issue(next.artists,{name:draft.name,danbooruId:draft.danbooruId});next.artists.push(draft);}else next.artists[i]=draft;
    next.artists.forEach((a,j)=>a.order=j+1);next.tags=unique([...next.tags,...draft.tags]);
    await new Promise(resolve=>morphAway(editingId,resolve));
    closeEditor();
    await save(next,'已保存 '+name);
  }
  async function removeArtist(){
    if(busy||uploading||!draft)return;
    const next=clone(data);next.artists=next.artists.filter(a=>a.uid!==editingId);next.artists.forEach((a,i)=>a.order=i+1);
    await new Promise(resolve=>morphAway(editingId,resolve));
    closeEditor();
    await save(next,'已删除画师');
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
  const removeButton=()=>confirmButton('删除画师','再次点击确认删除',removeArtist);
  const readImage=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败。'));reader.readAsDataURL(file);});
  const thumbnail=dataUrl=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{try{const scale=Math.min(1,400/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.8));}catch{reject(Error('图片处理失败。'));}};img.onerror=()=>reject(Error('图片读取失败。'));img.src=dataUrl;});
  async function upload(e){
    if(busy||uploading||!draft)return;uploading=true;setEditorError('正在处理图片…');
    try{const added=[];
      for(const f of e.target.files){
        if(!UPLOAD_TYPES.includes(f.type)||f.size>FolderStore.MAX_IMAGE_BYTES)throw Error('请选择不超过 50 MB 的 JPG、PNG、WebP、GIF 或 AVIF 图片。');
        const original=await readImage(f);
        added.push({id:'',url:'',caption:'',thumb:await thumbnail(original),large:original,thumbUrl:null,largeUrl:null});
      }
      draft.works.push(...added);setEditorError('');render();
    }catch(error){setEditorError(error.message);}
    finally{uploading=false;e.target.value='';}
  }
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
      handle.setAttribute('aria-label','拖动排序：'+name);
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
    $('tab-category').setAttribute('aria-selected',String(isCategory));
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
  const BATCH_CHUNK=25,BATCH_WORKS=3;
  let batchStop=false;const batchFailed=[];
  async function enrichArtists(names,order=DEFAULT_WORK_ORDER){
    const message=$('batch-message'),total=names.length;
    let done=0,failed=0,renamed=0,images=0;
    const report=()=>{message.textContent=`正在采集 ${done} / ${total} · 补编号 ${renamed} · 缩略图 ${images} 张${failed?` · 失败 ${failed}`:''}`;};
    for(let i=0;i<total&&!batchStop;i+=BATCH_CHUNK){
      const next=clone(data);
      for(const name of names.slice(i,i+BATCH_CHUNK)){
        if(batchStop)break;
        const artist=next.artists.find(a=>a.name===name);done++;
        if(!artist||(artist.counts&&artist.counts.checkedAt)){report();continue;}
        try{
          const detail=await ArtistLookup.details(name,next.cutoffDate,{previews:true,order});
          if(detail.countsError)throw Error('作品数量读取失败');
          let hit=null;
          try{hit=await lookupArtist(name);}catch{}
          /* 站点上已有正式名、且不和库里别的画师撞名，就跟着改过去 */
          const taken=new Set(next.artists.filter(a=>a!==artist).map(a=>a.name.toLowerCase()));
          const canonical=hit&&hit.canonical&&hit.canonical!==name&&!taken.has(hit.canonical.toLowerCase())?hit.canonical:name;
          const danbooruId=hit&&hit.id!=null?hit.id:(Number.isSafeInteger(artist.danbooruId)?artist.danbooruId:null);
          if(reidentify(artist,canonical,danbooruId))renamed++;
          if(canonical!==artist.name)artist.name=canonical;
          if(danbooruId!=null)artist.danbooruId=danbooruId;
          if(hit&&hit.aliases.length)artist.aliases=hit.aliases;
          const works=await cacheWorks(artist.uid,detail.works.slice(0,BATCH_WORKS));
          images+=works.filter(w=>typeof w.thumb==='string'&&w.thumb.startsWith('data:')).length;
          artist.counts={...detail.counts};artist.works=works;
        }catch(error){failed++;if(batchFailed.length<5)batchFailed.push(name+'：'+error.message);}
        report();
      }
      await save(next,`已采集 ${done} / ${total} 位画师的作品`);
      if(batchStop)break;
    }
    return {done,failed,renamed,images};
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
  /* 导入完成后按名字找回刚加进来的画师（补编号可能改了 uid，所以按名字找），逐个排入生成队列。
     排队是异步的，导入本身该结束就结束，不等生成。 */
  function queueTestImages(names,stopped){
    if(stopped){status('导入已中止，没有排入生成需求。');return 0;}
    let queued=0;
    for(const name of names){const artist=data.artists.find(a=>a.name===name);if(artist&&enqueueGenerate(artist,1,null))queued++;}
    if(queued)status(`已为 ${queued} 位画师排入「生成测试风格 1」，队列一条一条跑，两条之间隔 5±3 秒。`);
    return queued;
  }
  async function batch(e){
    e.preventDefault();if(busy)return;const names=unique($('batch-names').value.split(/\r?\n/));if(!names.length)return;if(names.some(n=>n.length>160)){$('batch-message').textContent='名字不能超过 160 个字符，请检查是否每行一位。';return;}
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
    const next=clone(data),seen=new Set(next.artists.map(a=>a.name.toLowerCase())),added=[];let count=0;
    for(const name of names){if(seen.has(name.toLowerCase()))continue;seen.add(name.toLowerCase());if(next.artists.length>=20000){$('batch-message').textContent='最多支持 20,000 位画师。';return;}next.artists.push({uid:ArtistId.issue(next.artists,{name}),order:next.artists.length+1,name,category:null,score:null,aliases:[],alias:null,tags:[],artistUrl:'https://danbooru.donmai.us/posts?tags='+encodeURIComponent(name),description:'',note:'',works:[]});added.push(name);count++;}
    batchStop=false;batchFailed.length=0;
    reset();await save(next,`已添加 ${count} 位，跳过 ${names.length-count} 个重复名字`);
    const summary=`已添加 ${count} 位，跳过 ${names.length-count} 个重复名字`;
    if(collect&&added.length){
      $('batch-message').textContent=`开始采集 ${added.length} 位画师的最新 ${BATCH_WORKS} 张作品…`;
      const result=await enrichArtists(added,order);
      $('batch-message').textContent=`${summary}。采集 ${result.done} 位 · 补编号 ${result.renamed} · 缩略图 ${result.images} 张${result.failed?` · 失败 ${result.failed}（${batchFailed.join('；')}）`:''}${batchStop?' · 已中止，再次提交同一名单会跳过已采集的画师':''}。`;
    }else $('batch-message').textContent=summary+'。';
    /* 采集完再排队：那时 uid 才是最终的，排进去的才会真的找到人。 */
    const queued=alsoGenerate?queueTestImages(added,batchStop):0;
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
        try{
          await picker.ready;
          const next=clone(data),uid=ArtistId.issue(next.artists,{name:artist.name,danbooruId:artist.id});
          const [saved,quantity]=await Promise.all([cacheWorks(uid,chosen),ArtistLookup.details(artist.name,data.cutoffDate,{previews:false})]);
          if(sequence!==lookupSequence||exists())return;
          next.artists.push({uid,order:next.artists.length+1,name:artist.name,danbooruId:artist.id,counts:{...quantity.counts},category:null,score:null,aliases:[...artist.aliases],alias:null,tags:[],artistUrl:artist.pageUrl,description:'',note:'',works:saved});
          await save(next,`已添加 ${artist.name} · ${saved.length} 张预览图`);
          if(sequence===lookupSequence){cancelLookup();$('quick-input').value='';clearCandidates();$('quick-site').hidden=true;$('quick-status').textContent=`已添加 ${artist.name}。可继续输入下一位；如列表被筛选，可按名字搜索。`;$('quick-input').focus();}
        }catch(error){add.disabled=false;add.textContent='添加此画师';$('quick-status').textContent='添加失败：'+error.message;}
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
    try{const results=await ArtistLookup.lookup(p,{signal:controller.signal});if(sequence!==lookupSequence)return;lookupCache.set(p.apiUrl,{time:Date.now(),results});if(lookupCache.size>100)lookupCache.delete(lookupCache.keys().next().value);showCandidates(results,p,sequence);}
    catch(error){if(sequence!==lookupSequence)return;$('quick-status').textContent=error.name==='AbortError'?'查询超时，请重试或打开站内检索。':error instanceof TypeError?'暂时无法跨站读取 Danbooru。请打开站内检索核验，或稍后重试。':error.message;}
    finally{clearTimeout(timeout);}
  }
  function quickChanged(e){
    cancelLookup();clearCandidates();$('quick-site').hidden=true;
    if(e?.isComposing)return;
    const value=$('quick-input').value.trim();$('quick-status').textContent=value?'等待输入完成…':'输入标签或链接，识别后点击候选画师添加。';
    if(value.length>=2||/^\d$/.test(value))lookupTimer=setTimeout(detectArtist,800);
  }
  /* 扩展右键菜单「添加到画师库」：把选中的文字送进「添加下一位画师」这条路——
     填进输入框、滚到那一块、直接开始识别，接下来和手动输入完全一样。 */
  function addFromSelection(text){
    const value=String(text||'').replace(/\s+/g,' ').trim().slice(0,200);
    if(!value){status('选中的文字是空的，没有可识别的画师。',true);return;}
    cancelLookup();clearCandidates();
    const input=$('quick-input');input.value=value;
    const section=$('quick-add');
    if(section?.scrollIntoView)section.scrollIntoView({block:'center'});
    if(input.focus)input.focus();
    status(`已从右键菜单收到「${value}」，正在识别画师…`);
    detectArtist();
  }
  /* 右键菜单「添加到画师库」：直接按选中文字建一张新卡（等价于批量导入一位）。
     只有能定位到唯一的 Danbooru 画师、并且取到作品，才算成功——不做「先建个空卡再说」这种脏数据。 */
  async function createArtistFromSelection(text){
    const value=String(text||'').replace(/\s+/g,' ').trim().slice(0,200);
    if(!value)return {ok:false,reason:'选中的文字是空的。',text:value};
    if(!folder)return {ok:false,reason:'还没有可用的数据文件夹（可能上次那个搬走了、或权限被拒了）：点提示打开画师库选一次，之后再右键就不用管了。',text:value};
    if(busy||syncingAll)return {ok:false,reason:'画师库正忙（保存或刷新中），过一会儿再右键一次。',text:value};
    let plan;try{plan=ArtistLookup.plan(value,{match:'name'});}catch(error){return {ok:false,reason:error.message,text:value};}
    let found;try{found=await ArtistLookup.lookup(plan);}catch(error){return {ok:false,reason:error.message,text:value};}
    /* 选中的常常是「tag 编号」「tag（@tag）」这类一整段：整段没匹配上，就再试第一个像标签的词。 */
    if(!found.length&&plan.kind==='name'&&/\s/.test(value)){
      const first=value.split(/\s+/)[0].replace(/^@/,'');
      if(/^[\w-]{2,}$/.test(first)){try{plan=ArtistLookup.plan(first,{match:'name'});found=await ArtistLookup.lookup(plan);}catch{}}
    }
    const wanted=String(plan.query||'').toLowerCase(),exact=found.find(item=>item.name.toLowerCase()===wanted);
    const chosen=plan.kind==='id'?found[0]:(exact||(found.length===1?found[0]:null));
    if(!chosen)return {ok:false,reason:found.length?`匹配到 ${found.length} 个候选（${found.slice(0,3).map(item=>item.name).join('、')}），需要手动确认`:'站点上没找到这个画师',text:value};
    const exists=data.artists.find(item=>item.name.toLowerCase()===chosen.name.toLowerCase()||(chosen.id&&item.danbooruId===chosen.id));
    if(exists)return {ok:false,reason:`「${exists.name}」已经在画师库里了`,uid:exists.uid,text:value};
    let works=[];try{works=await ArtistLookup.posts(chosen.name,{limit:3,order:data.workOrder});}catch{}
    if(!works.length)return {ok:false,reason:`找到「${chosen.name}」，但没取到作品（可能都被隐藏了），没有建卡`,text:value};
    try{
      const next=clone(data),uid=ArtistId.issue(next.artists,{name:chosen.name,danbooruId:chosen.id});
      const [saved,quantity]=await Promise.all([cacheWorks(uid,works),ArtistLookup.details(chosen.name,data.cutoffDate,{previews:false,order:data.workOrder})]);
      next.artists.push({uid,order:next.artists.length+1,name:chosen.name,danbooruId:chosen.id,counts:{...quantity.counts},category:null,score:null,aliases:[...chosen.aliases],alias:null,tags:[],artistUrl:chosen.pageUrl,description:'',note:'',works:saved});
      await save(next,`右键菜单已添加 ${chosen.name} · ${saved.length} 张作品`);
      return {ok:true,uid,name:chosen.name,danbooruId:chosen.id,works:saved.length,text:value};
    }catch(error){return {ok:false,reason:'写入失败：'+error.message,text:value};}
  }
  /* 点漂浮提示回到页面时：清掉筛选、滚到那位画师、闪一下边框。
     页面在后台时滚动是没用的（浏览器不做布局、IntersectionObserver 也不触发），
     所以先记下来，等这一页真的可见了再滚。 */
  let focusPending=null;
  function focusArtist(uid,text){
    if(!uid){if(text)addFromSelection(text);return;}
    const artist=data.artists.find(item=>item.uid===uid);
    if(!artist){if(text)addFromSelection(text);else status('这张卡片已经不在库里了。',true);return;}
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
    if(slot?.scrollIntoView)slot.scrollIntoView({block:'center'});
    /* 挂载后卡片高度从估算值变成真实值，位置会动，下一帧再对准一次。 */
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>{if(slot?.scrollIntoView)slot.scrollIntoView({block:'center'});});
    const card=slot?.firstElementChild||slot?.children?.[0];
    if(card?.classList){card.classList.add('is-focus-flash');setTimeout(()=>card.classList.remove('is-focus-flash'),3200);}
    setTimeout(()=>ArtistGallery.pin(uid,false),6000);
    status(`已定位到「${name}」`);
  }
  if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('visibilitychange',()=>{if(!document.hidden)applyFocus();});
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
      if(message?.type==='artist-library.focus'){focusArtist(message.uid,message.text);return;}
    });
    try{
      runtime.sendMessage({channel:'artist-library-page',type:'ready'}).then(answer=>{
        for(const action of answer?.actions||[])handleAction(action,send);
      }).catch(()=>{});
    }catch{}
  }
  /* 待办里的建卡排到「数据文件夹就绪」之后再跑：页面刚被右键菜单打开时，
     文件夹是这一刻才接上的（可能来自记忆、也可能要用户选一次），急不得。 */
  let queuedCreate=null,queuedTimer=null;
  function runCreate(action,send){
    createArtistFromSelection(action.text).then(result=>send({channel:'artist-library-page',type:'created',result:{...result,requestId:action.requestId,sourceTabId:action.sourceTabId}}));
  }
  function runQueuedCreate(){
    clearTimeout(queuedTimer);queuedTimer=null;
    const queued=queuedCreate;queuedCreate=null;
    if(queued)runCreate(queued.action,queued.send);
  }
  function handleAction(action,send){
    if(action?.kind==='create'){
      if(!folder&&!queuedCreate){
        queuedCreate={action,send};
        status('右键菜单要添加一张新卡片：等数据文件夹就绪（可能要点一下「继续使用上次的文件夹」）就立刻写入…');
        /* 给用户足够时间去点那个「继续使用」，超时才如实说失败。 */
        queuedTimer=setTimeout(()=>{if(queuedCreate)runQueuedCreate();},60000);
        return;
      }
      runCreate(action,send);
      return;
    }
    if(action?.kind==='focus')focusArtist(action.uid,action.text);
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
    const node=$('opus-status'),line=$('gen-account');
    node.classList.toggle('error',error);line.classList.toggle('error',error);
    if(message){node.textContent='额度：…';line.textContent=message;return;}
    const info=ArtistImageGen.cachedAccount();
    if(!info){node.textContent='额度：未查询';line.textContent='点右边「刷新额度」读取 Opus 剩余张数与 Anlas 点数。';return;}
    const images=info.opusImages==null?'未知':('约 '+info.opusImages+' 张');
    const parts=[`套餐 ${tierName(info.tier)}`,`免费额度剩 ${images}${info.opusPercent==null?'':`（${info.opusPercent}%）`}`,`Anlas 点数 ${info.anlas}`,info.refillPercent?`每天回复约 ${info.refillPercent}%（≈ ${info.refillImages} 张）`:''].filter(Boolean);
    node.textContent='额度：'+images+(info.opusPercent==null?'':` ${info.opusPercent}%`)+' · '+info.anlas+' 点';
    node.title=parts.join('｜')+'（张数是按站点算式估算的，仅供参考）';
    line.textContent=parts.join('｜')+'。张数是按站点算式 17.3 × 百分比 估算的，仅供参考。';
  }
  async function refreshAccount(force){
    if(!ArtistImageGen.loadToken()){showAccount('还没有填写 token，填好并刷新后才能生成。');return null;}
    showAccount('正在读取 Opus 额度…');
    try{const info=await ArtistImageGen.account({force});showAccount('');return info;}
    catch(error){showAccount('读取额度失败：'+error.message,true);return null;}
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
    $('settings-open').onclick=()=>{$('history-date').value=data.cutoffDate;$('save-large').checked=data.saveLargeImages===true;$('fixed-test').checked=data.fixedTestSlots===true;$('work-order').value=data.workOrder;$('card-size').value=String(prefs.cardSize);$('card-size-value').textContent=prefs.cardSize;$('settings').showModal();};$('close-settings').onclick=()=>$('settings').close();
    $('gen-settings-open').onclick=()=>{fillGenSettings();showAccount();updateGenStatus();$('gen-settings').showModal();if(ArtistImageGen.loadToken()&&!ArtistImageGen.cachedAccount())refreshAccount(false);};$('close-gen-settings').onclick=()=>$('gen-settings').close();
    $('opus-status').onclick=()=>refreshAccount(true);
    $('gen-queue').onclick=()=>{const dropped=genQueue.clear();status(dropped?`已取消排队的 ${dropped} 条生成需求；正在跑的那条会跑完。`:'队列里没有等待中的需求。');};paintQueue();
    $('gen-account-refresh').onclick=()=>refreshAccount(true);
    $('card-size').oninput=()=>{const value=Number($('card-size').value);$('card-size-value').textContent=value;prefs.setCardSize(value);};
    $('save-large').onchange=async()=>{const next=clone(data);next.saveLargeImages=$('save-large').checked;await save(next,next.saveLargeImages?'已开启「保存大图」：预览作品时会保存原图':'已关闭「保存大图」：预览作品时不再保存原图');};
    $('fixed-test').onchange=async()=>{const next=clone(data);next.fixedTestSlots=$('fixed-test').checked;await save(next,next.fixedTestSlots?'已开启「固定测试风格图」：每张卡片右侧 2 格留给测试风格 1、2':'已关闭「固定测试风格图」：测试风格图不再占固定格子');};
    $('gen-check').onclick=()=>checkExtension();
    $('history-date').onchange=async()=>{const date=$('history-date').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ $('history-date').value=data.cutoffDate;return;}const next=clone(data);next.cutoffDate=date;await save(next,'已保存截至日期；下次保存画师时会按新日期更新该画师的数量。');};
    $('work-order').onchange=async()=>{const value=$('work-order').value;if(!WORK_ORDERS.includes(value)){ $('work-order').value=data.workOrder;return;}const next=clone(data);next.workOrder=value;await save(next,'已改为按「'+WORK_ORDER_LABELS[value]+'」采集作品');};
    $('add-artist').onclick=()=>startEdit(null);$('quick-form').onsubmit=e=>{e.preventDefault();detectArtist();};$('quick-input').oninput=quickChanged;$('quick-input').oncompositionend=quickChanged;bindExtensionMessages();
    $('quick-manual').onclick=()=>{cancelLookup();startEdit(null);const value=$('quick-input').value.trim();if(value&&draft){try{const p=ArtistLookup.plan(value);if(p.kind==='name')draft.name=p.query;else if(p.kind==='url')draft.artistUrl=p.query;render();}catch{}}};
    $('manage-tags').onclick=()=>{if(!busy){manageFilter.category='';manageFilter.tag='';$('category-search').value='';$('tag-search').value='';showManageTab('category');listCategories();listTags();$('tag-manager').showModal();}};$('close-tags').onclick=()=>$('tag-manager').close();
    $('tab-category').onclick=()=>showManageTab('category');$('tab-tag').onclick=()=>showManageTab('tag');
    $('sync-all').onclick=()=>{if(syncingAll){syncAllStop=true;return null;}return syncAllArtists();};
    $('category-search').oninput=e=>{manageFilter.category=e.target.value.trim().toLowerCase();listCategories();};
    $('tag-search').oninput=e=>{manageFilter.tag=e.target.value.trim().toLowerCase();listTags();};
    $('category-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const name=$('new-category').value.trim();if(!name)return;if(data.categories.includes(name)){alert('这个分类已存在。');return;}const next=clone(data);next.categories.push(name);await save(next);$('new-category').value='';listCategories();};$('tag-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const t=$('new-tag').value.trim();if(!t)return;if(data.tags.includes(t)){alert('这个标签已存在。');return;}const next=clone(data);next.tags.push(t);await save(next);$('new-tag').value='';listTags();};
    $('batch-artists').onclick=()=>{if(busy)return;$('batch-names').value='';$('batch-message').textContent='';$('batch-order').value=data.workOrder;disarmBatch();$('batch-dialog').showModal();};$('close-batch').onclick=()=>$('batch-dialog').close();$('batch-dialog').addEventListener('close',()=>{batchStop=true;disarmBatch();});$('batch-form').onsubmit=batch;$('names-file').onchange=async e=>{try{const f=e.target.files[0];if(f){if(f.size>5*1024*1024)throw Error('TXT 名单不能超过 5 MB。');$('batch-names').value=await f.text();}}catch(error){$('batch-message').textContent=error.message;}finally{e.target.value='';}};
    $('export-data').onclick=exportData;$('import-data').onclick=()=>{if(!busy)$('import-file').click();};$('import-file').onchange=importData;
    let searchTimer;$('search').oninput=e=>{state.query=e.target.value.trim().toLowerCase();clearTimeout(searchTimer);searchTimer=setTimeout(render,150);};$('reset').onclick=()=>{reset();render();};$('close-viewer').onclick=()=>$('viewer').close();
    ArtistViewer.init({getData:()=>data,getFolder:()=>folder,save,notify:status});
    $('viewer').addEventListener('close',()=>{ArtistImages.dispose('viewer');ArtistViewer.dispose();});$('save-original').onclick=()=>ArtistViewer.saveOriginal();
    document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();}));
    $('extension-status').onclick=checkExtension;
    /* 图片拖到格子以外的地方时，浏览器默认会直接打开那个文件、把当前页面顶掉（没保存的改动就没了）。
       在窗口这一层兜住：整页都不接受文件拖放，只有格子上的处理器会把事件拿走。 */
    window.addEventListener('dragover',event=>event.preventDefault());
    window.addEventListener('drop',event=>event.preventDefault());
    window.addEventListener('beforeunload',e=>{if(volatile||busy||generating||!genQueue.idle){e.preventDefault();e.returnValue='';}});render();document.querySelectorAll('button,input,textarea,select').forEach(b=>b.disabled=true);$('choose-folder').disabled=false;$('extension-status').disabled=false;$('choose-folder').onclick=connectFolder;checkExtension().then(autoAccount);restoreFolder();
  }
  init();
})();
