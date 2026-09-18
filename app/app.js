(() => {
  'use strict';
  const categories=['二次元','写实 / 半写实','Q版 / 卡通','概念 / 设定','场景 / 环境'];
  const defaults=['可爱','唯美','暗黑','酷炫','清爽','华丽'];
  const $=id=>document.getElementById(id), clone=v=>structuredClone(v);
  const uid=()=>'draft-'+(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2));
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const btn=(text,fn,cls='action')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
  const unique=a=>[...new Set(a.filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean))];
  const text=(v,max=5000)=>typeof v==='string'?v.slice(0,max):'';
  const url=v=>{try{const u=new URL(v);return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}};
  const link=(label,href,cls)=>{const a=el('a',cls,label);a.href=url(href);a.target='_blank';a.rel='noopener noreferrer';return a;};
  const imageValue=v=>typeof v==='string'&&(/^data:image\/(jpeg|png|webp|gif|avif);base64,/.test(v)||/^(?:缩略图|大图)\/[a-f0-9]{24}\.(?:jpeg|png|webp|gif|avif)$/.test(v))?v:null;
  const httpsValue=v=>typeof v==='string'&&v.startsWith('https://')?v:null;
  const seqOf=a=>ArtistId.parse(a.uid)?.seq??a.order;
  const state={category:'全部',tags:new Set(),query:''};
  let data,folder,draft,editingId,busy=false,uploading=false,volatile=false;
  function normalize(raw,backup=false){
    if(!raw||!Array.isArray(raw.artists)||(backup&&raw.version!==1))throw Error('不是此网页导出的备份。');
    if(raw.artists.length>20000)throw Error('最多支持 20,000 位画师。');
    const names=new Set(),ids=new Set(),issued=[];
    const artists=raw.artists.map((a,i)=>{
      if(!a||typeof a.name!=='string'||!a.name.trim()||!Array.isArray(a.works))throw Error(`第 ${i+1} 位画师数据不完整。`);
      const name=a.name.trim().slice(0,160),key=name.toLowerCase();if(names.has(key))throw Error('重复画师：'+name);names.add(key);
      if(a.category&&!categories.includes(a.category))throw Error('不支持的主分类：'+a.category);
      const danbooruId=Number.isSafeInteger(a.danbooruId)&&a.danbooruId>0?a.danbooruId:null,stored=text(a.uid,100);
      const id=ArtistId.valid(stored)&&!ids.has(stored)?stored:ArtistId.issue(issued,{name,danbooruId});
      ids.add(id);issued.push({uid:id});
      const works=a.works.map(w=>{if(!FolderStore.validWork(w))throw Error(name+' 的图片格式或本地路径无效。');return {id:text(String(w.id??''),100),url:url(w.url),caption:text(w.caption),thumb:imageValue(w.thumb),thumbUrl:httpsValue(w.thumbUrl),previewUrl:httpsValue(w.previewUrl),large:imageValue(w.large),largeUrl:httpsValue(w.largeUrl)};});
      const c=a.counts||{},number=n=>Number.isSafeInteger(n)&&n>=0?n:null;
      return {uid:id,order:i+1,name,category:a.category||null,tags:unique(a.tags||[]).map(t=>t.slice(0,40)),danbooruId,counts:{total:number(c.total),checkedAt:text(c.checkedAt,40),beforeDate:text(c.beforeDate,10),beforeTotal:number(c.beforeTotal)},artistUrl:url(a.artistUrl),description:text(a.description),note:text(a.note),basis:text(a.basis,100),status:text(a.status,100),works};
    });
    return {version:1,cutoffDate:/^\d{4}-\d{2}-\d{2}$/.test(raw.cutoffDate)?raw.cutoffDate:'2026-07-01',date:text(raw.date,40),method:text(raw.method,12000),tags:unique([...(Array.isArray(raw.tags)?raw.tags:defaults),...artists.flatMap(a=>a.tags)]).map(t=>t.slice(0,40)),artists};
  }
  function status(t,error=false){$('storage-status').textContent=t;$('storage-status').classList.toggle('error',error);}
  async function write(value){if(!folder)throw Error('请先选择数据文件夹');return normalize(await FolderStore.write(folder,value));}
  async function connectFolder(){
    if(busy)return;
    if(!window.showDirectoryPicker){status('当前浏览器不支持文件夹读写，请使用最新版 Chrome 或 Edge 打开本 HTML。',true);return;}
    if(volatile){status('请先导出备份保留尚未保存的修改，再重新打开网页切换文件夹。',true);return;}
    try{const chosen=await window.showDirectoryPicker({id:'artist-library',mode:'readwrite'});status('正在读取画师资料（图片按需加载）…');const loaded=normalize(await FolderStore.read(chosen),true);cancelLookup();clearCandidates();folder=chosen;data=loaded;FolderStore.remember(chosen,loaded);ArtistImages.setFolder(chosen);reset();render();document.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=false);$('folder-name').textContent='当前文件夹：'+folder.name;status('已连接文件夹 · 图片滚动到附近才加载');}
    catch(error){if(error.name!=='AbortError')status('文件夹打开失败：'+error.message,true);}
  }
  async function save(next,message='已保存到数据文件夹'){
    busy=true;data=next;status('正在保存…');
    const controls=[...document.querySelectorAll('button,input,textarea,select')].map(e=>[e,e.disabled]);controls.forEach(([e])=>e.disabled=true);
    try{data=await write(data);volatile=false;const warnings=FolderStore.takeWarnings();status(warnings.length?message+'；'+warnings.join('；'):message,warnings.length>0);}catch(error){volatile=true;status('文件保存失败：'+error.message+'；修改暂留本页，请导出备份。',true);}finally{controls.forEach(([e,disabled])=>e.disabled=disabled);busy=false;render();}
  }
  function reset(){state.category='全部';state.tags.clear();state.query='';$('search').value='';}
  function showImage(a,w){
    ArtistImages.dispose('viewer');const img=$('large-image');
    $('viewer-title').textContent=a.name;$('large-image').alt=a.name+' 的作品';
    $('viewer-caption').textContent=w.caption||'作品预览';$('viewer-source').hidden=!w.url;if(w.url)$('viewer-source').href=w.url;
    $('viewer').showModal();ArtistImages.bind(img,a.uid,w,'viewer','thumb',error=>$('viewer-caption').textContent=error.message);
    loadOriginal(a,w);
  }
  async function loadOriginal(a,w){
    const img=$('large-image'),local=FolderStore.imageOf(w,'large');
    if(local?.kind==='local'){$('viewer-caption').textContent=w.caption||'本地原图';ArtistImages.bind(img,a.uid,w,'viewer','large',error=>$('viewer-caption').textContent=error.message);return;}
    $('viewer-caption').textContent='正在获取原图…';
    try{
      const remote=w.largeUrl||await ArtistExtension.resolve(w.id);
      if(!remote)throw Error('这张作品没有原图地址');
      const blob=await ArtistImages.fetch(a.uid,{...w,largeUrl:remote},'large');
      if(!folder)throw Error('请先选择数据文件夹');
      const path=await FolderStore.saveImage(folder,a.uid,'large',blob);
      const next=clone(data),target=next.artists.find(x=>x.uid===a.uid),index=target?target.works.findIndex(x=>x.id===w.id):-1;
      if(index<0)throw Error('作品已不在画师库中');
      target.works[index]={...target.works[index],large:path,largeUrl:remote};
      await save(next,'原图已保存到本地');
      if($('viewer').open){ArtistImages.dispose('viewer');ArtistImages.bind(img,a.uid,target.works[index],'viewer','large',error=>$('viewer-caption').textContent=error.message);$('viewer-caption').textContent=target.works[index].caption||'原图已保存到本地';}
    }catch(error){if(error.name!=='AbortError')$('viewer-caption').textContent='原图未取到：'+error.message+'（当前显示的是预览图）';}
  }
  function card(a){
    const article=el('article','artist'),info=el('div','artist-info'),top=el('div','artist-top');article.dataset.artist=a.name;
    const numbers=el('div','artist-numbers'),countLabel=el('span','work-count','作品数量：'+(a.counts?.total??'未读取')+'（'+(a.counts?.beforeTotal??'未读取')+'）');
    countLabel.title=a.counts?.beforeDate?'括号内数量使用的截至日期：'+a.counts.beforeDate+(a.counts.beforeDate!==data.cutoffDate?'；设置已变更，点击刷新后更新。':''):'括号内为截至日期数量，点击刷新读取。';
    const refresh=btn('刷新',async()=>{
      if(busy||refresh.disabled)return;refresh.disabled=true;refresh.textContent='刷新中…';const date=data.cutoffDate;
      try{const result=await ArtistLookup.details(a.name,date,{previews:false});const next=clone(data),target=next.artists.find(x=>x.uid===a.uid&&x.name===a.name);if(!target)return;const prior=target.counts||{};
        target.counts={...prior};if(result.counts.total!==null){target.counts.total=result.counts.total;target.counts.checkedAt=result.counts.checkedAt;}if(result.counts.beforeTotal!==null){target.counts.beforeTotal=result.counts.beforeTotal;target.counts.beforeDate=date;}
        await save(next,result.countsError?'部分数量读取失败，失败项保留原值':'已刷新 '+a.name+' 的作品数量');
      }catch(error){status('刷新失败：'+error.message,true);}finally{refresh.disabled=false;refresh.textContent='刷新';}
    },'count-refresh');
    numbers.append(el('span','serial',String(seqOf(a)).padStart(4,'0')),countLabel,refresh);top.append(numbers);info.append(top,el('h2','',a.name),el('span',a.category?'primary':'pending-badge',a.category||'待判断'));
    if(a.basis)info.append(el('span','basis',a.basis));const ts=el('div','secondary');a.tags.forEach(t=>ts.append(el('span','',t)));info.append(ts,el('p','description',a.description||'点击编辑，记录画风和特点。'));const actions=el('div','artist-actions');if(a.artistUrl)actions.append(link('画师页面 ↗',a.artistUrl,'artist-link'));actions.append(btn('编辑',()=>edit(a),'edit-button'));info.append(actions);
    const works=el('div','works');if(!a.works.length){const empty=el('div','unavailable');empty.append(el('strong','',a.status||'还没有作品图片'),el('span','',a.note||'编辑画师，上传你想参考的作品。'));works.append(empty);}
    a.works.slice(0,5).forEach((w,i)=>{const figure=el('figure','work'),b=btn('',()=>showImage(a,w),'thumb'),img=el('img');b.setAttribute('aria-label',`查看 ${a.name} 的作品 ${i+1}`);img.alt=a.name+' 的作品';ArtistImages.bind(img,a.uid,w,'card:'+a.uid,'thumb');b.append(img);const caption=el('figcaption');caption.append(el('span','',w.id?'#'+w.id:'作品 '+(i+1)));if(w.url)caption.append(link('来源 ↗',w.url));figure.append(b,caption);works.append(figure);});
    if(a.works.length)works.append(el('p','sample-note',a.works.length+' 张图片'+(a.works.length>5?' · 卡片预览前 5 张，编辑可查看全部':'')+(a.note?' · '+a.note:'')));article.append(info,works);return article;
  }
  function render(){
    $('history-date').value=data.cutoffDate;
    $('choose-date').textContent='数据截至日期：'+data.cutoffDate;
    $('categories').replaceChildren(...['全部',...categories,'待判断'].map(c=>{const n=data.artists.filter(a=>c==='全部'||(c==='待判断'?!a.category:a.category===c)).length;const b=btn(c,()=>{state.category=c;render();},c===state.category?'active':'');b.setAttribute('aria-pressed',String(c===state.category));b.append(el('span','n',n));return b;}));
    $('tags').replaceChildren(...data.tags.map(t=>{const b=btn(t,()=>{state.tags.has(t)?state.tags.delete(t):state.tags.add(t);render();},state.tags.has(t)?'active':'');b.setAttribute('aria-pressed',String(state.tags.has(t)));return b;}));
    const rows=data.artists.filter(a=>(state.category==='全部'||(state.category==='待判断'?!a.category:a.category===state.category))&&[...state.tags].every(t=>a.tags.includes(t))&&a.name.toLowerCase().includes(state.query));
    ArtistGallery.render($('gallery'),rows,card);$('count').textContent=`找到 ${rows.length} / ${data.artists.length} 位 · 连续滚动，按需加载${state.tags.size>1?' · 同时包含所选标签':''}`;$('empty').hidden=rows.length!==0;
    $('library-summary').textContent=`${data.artists.length} 位画师 · ${data.artists.reduce((n,a)=>n+a.works.length,0)} 张作品 · 由你自由整理`;$('sample-date').textContent=data.date?'初始样本日期：'+data.date:'';
    $('method').textContent='每位画师的信息、缩略图和原图保存在 数据/画师/序号-名字-编号 的独立目录中。主页面只加载缩略图，点开作品时才获取原图并存到本地。修改自动写入文件。Esc 直接关闭编辑页，未保存编辑不保留。数量是 Danbooru 中当前可查询的作品数；日期数量按上传时间筛选，不能还原历史时刻的删帖、改标签状态。日期边界采用站点时区。备份也可以直接复制整个数据文件夹。';
  }
  function tagPicker(){
    $('editor-tags').replaceChildren(...unique([...data.tags,...draft.tags]).map(t=>{const l=el('label','tag-choice'),c=el('input');c.type='checkbox';c.checked=draft.tags.includes(t);c.onchange=()=>{draft.tags=c.checked?unique([...draft.tags,t]):draft.tags.filter(x=>x!==t);};l.append(c,el('span','',t));return l;}));
  }
  function workEditor(){
    ArtistImages.dispose('editor');$('editor-works').replaceChildren(...draft.works.map((w,i)=>{const row=el('div','work-editor'),img=el('img'),fields=el('div','work-fields');img.alt='作品 '+(i+1);ArtistImages.bind(img,draft.uid,w,'editor','thumb');const local=FolderStore.imageOf(w,'large')?.kind==='local';fields.append(el('small','work-state',local?'原图已存本地':'点开作品时获取原图'));for(const [key,title,type] of [['url','作品来源链接','url'],['caption','图片说明','text']]){const label=el('label','',title),input=el('input');input.type=type;input.value=w[key]||'';input.maxLength=5000;input.oninput=()=>w[key]=input.value;label.append(input);fields.append(label);}row.append(img,fields,btn('移除',()=>{draft.works.splice(i,1);workEditor();},'danger'));return row;}));
  }
  function edit(a){
    if(busy)return;editingId=a?.uid||null;draft=a?clone(a):{uid:uid(),name:'',category:null,tags:[],artistUrl:'',description:'',note:'',works:[]};
    $('editor-title').textContent=a?'编辑画师':'添加画师';$('artist-name').value=draft.name;$('artist-category').value=draft.category||'';$('artist-url').value=draft.artistUrl;$('artist-description').value=draft.description;$('artist-note').value=draft.note;$('draft-tag').value='';$('editor-error').textContent='';$('delete-artist').hidden=!a;closeWorkPicker();tagPicker();workEditor();$('editor').showModal();
  }
  let editorPicker=null;
  function closeWorkPicker(){if(editorPicker){editorPicker.dispose();editorPicker=null;}const panel=$('work-picker');panel.hidden=true;panel.replaceChildren();}
  function openWorkPicker(){
    if(editorPicker){closeWorkPicker();return;}
    const tag=(draft.name||'').trim(),panel=$('work-picker');
    if(!tag){$('editor-error').textContent='先在「画师名字」里填 Danbooru 标签，再用它去找作品。';return;}
    $('editor-error').textContent='';panel.hidden=false;panel.replaceChildren();
    const exclude=new Set(draft.works.map(w=>w.id).filter(Boolean));
    editorPicker=WorkPicker.mount(panel,{uid:draft.uid,tag,exclude,onPreview:work=>previewWork(draft.name,work,draft.uid)});
    const action=btn('添加所选到作品列表',async()=>{
      const chosen=editorPicker.selected();
      if(!chosen.length){$('editor-error').textContent='请先勾选要添加的作品。';return;}
      action.disabled=true;action.textContent='正在下载缩略图…';
      try{const saved=await cacheWorks(draft.uid,chosen);draft.works.push(...saved);workEditor();closeWorkPicker();$('editor-error').textContent=`已加入 ${saved.length} 张，点「保存修改」后写入画师目录。`;}
      catch(error){$('editor-error').textContent='添加失败：'+error.message;}
      finally{action.disabled=false;action.textContent='添加所选到作品列表';}
    },'action primary-action'),bar=el('div','picker-actions');
    bar.append(action,btn('关闭',closeWorkPicker));panel.append(bar);
  }
  function closeEditor(){if(!busy&&!uploading)$('editor').close();}
  async function saveArtist(e){
    e.preventDefault();if(busy||uploading)return;const name=$('artist-name').value.trim(),href=$('artist-url').value.trim();
    if(!name){$('editor-error').textContent='请填写名字。';return;}
    if(data.artists.some(a=>a.uid!==editingId&&a.name.toLowerCase()===name.toLowerCase())){$('editor-error').textContent='已有同名画师。';return;}
    if((href&&!url(href))||draft.works.some(w=>w.url&&!url(w.url))){$('editor-error').textContent='链接只支持 http:// 或 https://。';return;}
    if(name!==draft.name){draft.counts=null;draft.danbooruId=null;}
    Object.assign(draft,{name,category:$('artist-category').value||null,artistUrl:url(href),description:$('artist-description').value.trim(),note:$('artist-note').value.trim(),basis:'',status:''});draft.works.forEach(w=>w.url=url(w.url));
    const next=clone(data),i=next.artists.findIndex(a=>a.uid===editingId);
    if(i<0){draft.uid=ArtistId.issue(next.artists,{name:draft.name,danbooruId:draft.danbooruId});next.artists.push(draft);}else next.artists[i]=draft;
    next.artists.forEach((a,j)=>a.order=j+1);next.tags=unique([...next.tags,...draft.tags]);await save(next);$('editor').close();
  }
  const readImage=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败。'));reader.readAsDataURL(file);});
  const thumbnail=dataUrl=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{try{const scale=Math.min(1,400/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.8));}catch{reject(Error('图片处理失败。'));}};img.onerror=()=>reject(Error('图片读取失败。'));img.src=dataUrl;});
  async function upload(e){
    if(busy||uploading)return;uploading=true;$('save-artist').disabled=true;$('editor-error').textContent='正在处理图片…';
    try{const added=[];
      for(const f of e.target.files){
        if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(f.type)||f.size>50*1024*1024)throw Error('请选择不超过 50 MB 的 JPG、PNG、WebP、GIF 或 AVIF 图片。');
        const original=await readImage(f);
        added.push({id:'',url:'',caption:'',thumb:await thumbnail(original),large:original,thumbUrl:null,largeUrl:null});
      }
      draft.works.push(...added);workEditor();$('editor-error').textContent='';}catch(error){$('editor-error').textContent=error.message;}finally{uploading=false;$('save-artist').disabled=false;e.target.value='';}
  }
  function listTags(){
    $('tag-list').replaceChildren(...data.tags.map(t=>{const row=el('div','manage-tag-row'),input=el('input');input.value=t;input.maxLength=40;input.setAttribute('aria-label','重命名标签 '+t);row.append(input,btn('重命名',async()=>{if(busy)return;const name=input.value.trim();if(!name||name===t)return;if(data.tags.includes(name)){alert('这个标签已存在。');return;}const next=clone(data);next.tags=next.tags.map(x=>x===t?name:x);next.artists.forEach(a=>a.tags=a.tags.map(x=>x===t?name:x));if(state.tags.delete(t))state.tags.add(name);await save(next);listTags();}),btn('删除',async()=>{if(busy||!confirm(`删除标签「${t}」并从画师上移除？画师和图片会保留。`))return;const next=clone(data);next.tags=next.tags.filter(x=>x!==t);next.artists.forEach(a=>a.tags=a.tags.filter(x=>x!==t));state.tags.delete(t);await save(next);listTags();},'danger'));return row;}));
  }
  async function exportData(){
    if(busy)return;let stream;const controls=[...document.querySelectorAll('button,input,textarea,select')].map(e=>[e,e.disabled]);
    try{const handle=await window.showSaveFilePicker({suggestedName:'画师库备份_'+new Date().toISOString().slice(0,10)+'.json',types:[{description:'画师库 JSON',accept:{'application/json':['.json']}}]});busy=true;controls.forEach(([e])=>e.disabled=true);stream=await handle.createWritable();await FolderStore.exportTo(folder,data,stream,(i,n)=>status(`正在导出 ${i} / ${n} 位画师…`));await stream.close();stream=null;status('备份已保存，包含本地缩略图与原图；未下载的原图保留在线链接。');
    }catch(error){if(stream)await stream.abort().catch(()=>{});if(error.name!=='AbortError')status('备份失败：'+error.message,true);}finally{busy=false;controls.forEach(([e,disabled])=>e.disabled=disabled);}
  }
  async function importData(e){
    const f=e.target.files[0];e.target.value='';if(!f||busy)return;
    try{if(f.size>100*1024*1024)throw Error('超过 100 MB 的备份请使用完整「数据」文件夹恢复，避免一次解析全部图片占满内存。');const next=normalize(JSON.parse(await f.text()),true);if(next.artists.some(a=>a.works.some(w=>FolderStore.imageOf(w,'thumb')?.kind==='local')))throw Error('这份 JSON 未包含图片，请直接选择对应数据文件夹。');if(!confirm(`用备份中的 ${next.artists.length} 位画师替换当前 ${data.artists.length} 位？建议先导出当前备份。`))return;reset();await save(next,'已导入备份');ArtistImages.clear();}catch(error){alert('导入失败。\n'+error.message);}
  }
  async function batch(e){
    e.preventDefault();if(busy)return;const names=unique($('batch-names').value.split(/\r?\n/));if(!names.length)return;if(names.some(n=>n.length>160)){$('batch-message').textContent='名字不能超过 160 个字符，请检查是否每行一位。';return;}
    const next=clone(data),seen=new Set(next.artists.map(a=>a.name.toLowerCase()));let count=0;
    for(const name of names){if(seen.has(name.toLowerCase()))continue;seen.add(name.toLowerCase());if(next.artists.length>=20000){$('batch-message').textContent='最多支持 20,000 位画师。';return;}next.artists.push({uid:ArtistId.issue(next.artists,{name}),order:next.artists.length+1,name,category:null,tags:[],artistUrl:'https://danbooru.donmai.us/posts?tags='+encodeURIComponent(name),description:'',note:'',works:[]});count++;}
    reset();await save(next,`已添加 ${count} 位，跳过 ${names.length-count} 个重复名字`);$('batch-dialog').close();
  }
  let lookupTimer,lookupController,lookupSequence=0;
  async function checkExtension(){try{const version=await ArtistExtension.check();$('extension-status').textContent='图片助手已连接 · '+version;$('extension-status').title='扩展取图可用';ArtistImages.clear();}catch(error){$('extension-status').textContent='图片助手未连接 · 点击重试';$('extension-status').title=error.message;status(error.message,true);}}
  async function cacheWorks(id,works){
    const result=[];
    for(const w of works){
      if(FolderStore.imageOf(w,'thumb')?.kind==='local'){result.push(w);continue;}
      try{const thumb=await ArtistImages.dataUrl(id,w,'thumb');result.push({...w,thumb,caption:w.caption?.startsWith('预览图未能')?'':w.caption});}
      catch(error){result.push({...w,caption:'预览图未能缓存：'+error.message});}
    }
    return result;
  }
  let caching=false;
  async function cacheVisible(){
    if(busy||caching)return;const targets=ArtistGallery.visible().map(a=>a.uid),originalFolder=folder;caching=true;$('cache-visible').disabled=true;let cached=0,failed=0;
    try{for(const id of targets){if(originalFolder!==folder)break;const a=data.artists.find(x=>x.uid===id);if(!a)continue;const remote=a.works.filter(w=>FolderStore.imageOf(w,'thumb')?.kind==='remote');if(!remote.length)continue;status('正在缓存 '+a.name+' 的预览图…');const converted=await cacheWorks(id,remote);if(originalFolder!==folder)break;const next=clone(data),target=next.artists.find(x=>x.uid===id);if(!target)continue;
        for(let i=0;i<remote.length;i++){const index=target.works.findIndex(w=>w.id===remote[i].id);if(index<0)continue;if(converted[i].thumb?.startsWith('data:')){target.works[index]={...target.works[index],thumb:converted[i].thumb,caption:converted[i].caption};cached++;}else failed++;}await save(next,'已缓存 '+a.name+' 的预览图');if(volatile){status('预览图已获取，但写入文件失败。已停止缓存，请导出备份保留本页修改。',true);return;}}
      status(`预览图缓存完成：${cached} 张已保存${failed?'，'+failed+' 张失败，可稍后重试':''}。只处理点击时附近已加载的画师。`,failed>0);
    }finally{caching=false;$('cache-visible').disabled=false;}
  }
  const lookupCache=new Map();let activePickers=[];
  function clearCandidates(){for(const picker of activePickers)picker.dispose();activePickers=[];$('quick-results').replaceChildren();}
  function cancelLookup(){clearTimeout(lookupTimer);lookupController?.abort();lookupSequence++;}
  function focusQuick(){ $('quick-add').scrollIntoView({behavior:'smooth',block:'center'});$('quick-input').focus(); }
  function previewWork(name,work,uid){
    ArtistImages.dispose('viewer');const img=$('large-image');
    $('viewer-title').textContent=name+' #'+work.id;$('large-image').alt=name+' #'+work.id;
    $('viewer-caption').textContent='正在读取放大图…';$('viewer-source').hidden=!work.url;if(work.url)$('viewer-source').href=work.url;
    $('viewer').showModal();
    img.onload=()=>{$('viewer-caption').textContent='放大预览 · 勾选后才会保存到画师库';};
    ArtistImages.bind(img,uid,work,'viewer','preview',error=>{$('viewer-caption').textContent='放大图未取到：'+error.message;});
  }
  function showCandidates(results,p,sequence){
    clearCandidates();
    $('quick-status').textContent=results.length?`找到 ${results.length} 位候选，请核对正式标签后勾选要保存的作品。`:'未找到匹配。可以使用站内检索检查别名或主页链接。';
    for(const artist of results){
      const row=el('div','candidate'),detail=el('div','candidate-info');detail.append(el('strong','',artist.name),el('span','',`Danbooru #${artist.id}`));
      if(artist.aliases.length)detail.append(el('small','',`别名：${artist.aliases.join('、')}`));detail.append(link('核对画师资料 ↗',artist.pageUrl));
      const countLine=el('small','','作品数量：读取中…');detail.append(countLine);
      const body=el('div','candidate-body');detail.append(body);
      const previewUid='preview-'+artist.id;
      const picker=WorkPicker.mount(body,{uid:previewUid,tag:artist.name,onPreview:work=>previewWork(artist.name,work,previewUid)});activePickers.push(picker);
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
          next.artists.push({uid,order:next.artists.length+1,name:artist.name,danbooruId:artist.id,counts:{...quantity.counts},category:null,tags:[],artistUrl:artist.pageUrl,description:'',note:'',works:saved});
          await save(next,`已添加 ${artist.name} · ${saved.length} 张预览图`);
          if(sequence===lookupSequence){cancelLookup();$('quick-input').value='';clearCandidates();$('quick-site').hidden=true;$('quick-status').textContent=`已添加 ${artist.name}。可继续输入下一位；如列表被筛选，可按名字搜索。`;$('quick-input').focus();}
        }catch(error){add.disabled=false;add.textContent='添加此画师';$('quick-status').textContent='添加失败：'+error.message;}
      },'action primary-action');add.disabled=exists();row.append(detail,add);$('quick-results').append(row);
    }
  }
  async function detectArtist(){
    cancelLookup();const sequence=lookupSequence,value=$('quick-input').value.trim();clearCandidates();$('quick-site').hidden=true;
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
  async function init(){
    data=normalize(FolderStore.empty());status('请先选择「数据」文件夹，读取或开始整理画师库。');
    $('choose-date').onclick=()=>$('date-dialog').showModal();$('close-date').onclick=()=>$('date-dialog').close();
    $('history-date').onchange=async()=>{const date=$('history-date').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ $('history-date').value=data.cutoffDate;return;}const next=clone(data);next.cutoffDate=date;await save(next,'已保存截至日期；点击画师旁的刷新后，该画师数量才会更新。');};
    $('artist-category').append(new Option('待判断',''),...categories.map(c=>new Option(c,c)));
    $('add-artist').onclick=focusQuick;$('quick-form').onsubmit=e=>{e.preventDefault();detectArtist();};$('quick-input').oninput=quickChanged;$('quick-input').oncompositionend=quickChanged;
    $('quick-manual').onclick=()=>{cancelLookup();edit();const value=$('quick-input').value.trim();if(value){try{const p=ArtistLookup.plan(value);if(p.kind==='name')$('artist-name').value=p.query;else if(p.kind==='url')$('artist-url').value=p.query;}catch{}}};
    $('artist-form').onsubmit=saveArtist;$('cancel-editor').onclick=closeEditor;$('editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor();});$('work-upload').onchange=upload;$('work-from-danbooru').onclick=openWorkPicker;
    $('add-draft-tag').onclick=()=>{const t=$('draft-tag').value.trim();if(t){draft.tags=unique([...draft.tags,t]);$('draft-tag').value='';tagPicker();}};$('draft-tag').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('add-draft-tag').click();}};
    $('delete-artist').onclick=async()=>{if(busy||uploading||!confirm(`删除画师「${draft.name}」及其在此画师库内的图片？`))return;const next=clone(data);next.artists=next.artists.filter(a=>a.uid!==editingId);next.artists.forEach((a,i)=>a.order=i+1);await save(next);$('editor').close();};
    $('manage-tags').onclick=()=>{if(!busy){listTags();$('tag-manager').showModal();}};$('close-tags').onclick=()=>$('tag-manager').close();$('tag-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const t=$('new-tag').value.trim();if(!t)return;if(data.tags.includes(t)){alert('这个标签已存在。');return;}const next=clone(data);next.tags.push(t);await save(next);$('new-tag').value='';listTags();};
    $('batch-artists').onclick=()=>{if(busy)return;$('batch-names').value='';$('batch-message').textContent='';$('batch-dialog').showModal();};$('close-batch').onclick=()=>$('batch-dialog').close();$('batch-form').onsubmit=batch;$('names-file').onchange=async e=>{try{const f=e.target.files[0];if(f){if(f.size>5*1024*1024)throw Error('TXT 名单不能超过 5 MB。');$('batch-names').value=await f.text();}}catch(error){$('batch-message').textContent=error.message;}finally{e.target.value='';}};
    $('export-data').onclick=exportData;$('import-data').onclick=()=>{if(!busy)$('import-file').click();};$('import-file').onchange=importData;
    let searchTimer;$('search').oninput=e=>{state.query=e.target.value.trim().toLowerCase();clearTimeout(searchTimer);searchTimer=setTimeout(render,150);};$('reset').onclick=()=>{reset();render();};$('close-viewer').onclick=()=>$('viewer').close();
    $('viewer').addEventListener('close',()=>ArtistImages.dispose('viewer'));$('editor').addEventListener('close',()=>{ArtistImages.dispose('editor');closeWorkPicker();draft=null;});
    document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;if(dialog.id==='editor')closeEditor();else dialog.close();}));
    $('cache-visible').onclick=cacheVisible;$('clear-image-cache').onclick=()=>{ArtistImages.clear();status('已释放临时图片缓存，本地图片文件未删除；当前可见图片会按需重载。');};$('extension-status').onclick=checkExtension;
    window.addEventListener('beforeunload',e=>{if(volatile||busy){e.preventDefault();e.returnValue='';}});render();document.querySelectorAll('button,input,textarea,select').forEach(b=>b.disabled=true);$('choose-folder').disabled=false;$('extension-status').disabled=false;$('choose-folder').onclick=connectFolder;checkExtension();
  }
  init();
})();
