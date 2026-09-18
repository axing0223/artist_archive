(() => {
  'use strict';
  const defaultCategories=['二次元','写实 / 半写实','Q版 / 卡通','概念 / 设定','场景 / 环境'];
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
  let data,folder,draft,editingId,busy=false,uploading=false,volatile=false,refreshTimer=null;
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
      return {uid:id,order:i+1,name,category:a.category||null,tags:unique(a.tags||[]).map(t=>t.slice(0,40)),danbooruId,counts:{total:number(c.total),checkedAt:text(c.checkedAt,40),beforeDate:text(c.beforeDate,10),beforeTotal:number(c.beforeTotal)},artistUrl:url(a.artistUrl),description:text(a.description),note:text(a.note),basis:text(a.basis,100),status:text(a.status,100),works};
    });
    return {version:1,categories:categoryList,cutoffDate:/^\d{4}-\d{2}-\d{2}$/.test(raw.cutoffDate)?raw.cutoffDate:'2026-07-01',saveLargeImages:raw.saveLargeImages===true,date:text(raw.date,40),method:text(raw.method,12000),tags:unique([...(Array.isArray(raw.tags)?raw.tags:defaults),...artists.flatMap(a=>a.tags)]).map(t=>t.slice(0,40)),artists};
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
  function showImage(a,w){ArtistViewer.open({title:a.name,uid:a.uid,work:w,caption:w.caption,persist:true});}
  function artistCard(a){
    const article=el('article','artist'),info=el('div','artist-info'),top=el('div','artist-top');article.dataset.artist=a.name;
    const numbers=el('div','artist-numbers'),countLabel=el('span','work-count','作品数量：'+(a.counts?.total??'未读取')+'（'+(a.counts?.beforeTotal??'未读取')+'）');
    countLabel.title=a.counts?.beforeDate?'括号内数量使用的截至日期：'+a.counts.beforeDate+(a.counts.beforeDate!==data.cutoffDate?'；设置已变更，点击刷新后更新。':''):'括号内为截至日期数量，点击刷新读取。';
    const refresh=btn('刷新',async()=>{
      if(busy||refresh.disabled)return;refresh.disabled=true;refresh.textContent='刷新中…';const date=data.cutoffDate;
      try{const result=await ArtistLookup.details(a.name,date,{previews:false});const next=clone(data),target=next.artists.find(x=>x.uid===a.uid&&x.name===a.name);if(!target)return;const prior=target.counts||{};
        target.counts={...prior};if(result.counts.total!==null){target.counts.total=result.counts.total;target.counts.checkedAt=result.counts.checkedAt;}if(result.counts.beforeTotal!==null){target.counts.beforeTotal=result.counts.beforeTotal;target.counts.beforeDate=date;}
        await save(next,result.countsError?'部分数量读取失败，失败项保留原值':'已刷新 '+a.name+' 的作品数量');
      }catch(error){status('刷新失败：'+error.message,true);}finally{refresh.disabled=false;refresh.textContent='刷新';}
    },'edit-button');
    numbers.append(el('span','serial',String(seqOf(a)).padStart(4,'0')),countLabel,refresh);top.append(numbers);info.append(top,el('h2','',a.name),el('span',a.category?'primary':'pending-badge',a.category||'待判断'));
    if(a.basis)info.append(el('span','basis',a.basis));const ts=el('div','secondary');a.tags.forEach(t=>ts.append(el('span','',t)));info.append(ts,el('p','description',a.description||'点击编辑，记录画风和特点。'));
    const actions=el('div','artist-actions');actions.append(btn('编辑',()=>startEdit(a),'edit-button'));if(a.artistUrl)actions.append(link('画师页面 ↗',a.artistUrl,'edit-button'));info.append(actions);
    const works=el('div','works');if(!a.works.length){const empty=el('div','unavailable');empty.append(el('strong','',a.status||'还没有作品图片'),el('span','',a.note||'编辑画师，上传你想参考的作品。'));works.append(empty);}
    FolderStore.previewWorks(a).forEach((w,i)=>{
      if(!w){works.append(el('div','work work-empty'));return;}
      const figure=el('figure','work'),b=btn('',()=>showImage(a,w),'thumb'),img=el('img');if(w.kind==='test')figure.classList.add('is-test');b.setAttribute('aria-label',`查看 ${a.name} 的${w.kind==='test'?'测试风格图片':'作品 '+(i+1)}`);img.alt=a.name+' 的作品';ArtistImages.bind(img,a.uid,w,'card:'+a.uid,'thumb');b.append(img);const caption=el('figcaption');caption.append(el('span','',w.kind==='test'?`测试风格 ${w.testSeq||1}`:w.id?'#'+w.id:'作品 '+(i+1)));if(w.url)caption.append(link('来源 ↗',w.url));figure.append(b,caption);works.append(figure);});
    if(a.note)works.append(el('p','sample-note',a.note));
    article.append(info,works);return article;
  }
  function card(a){return draft&&draft.uid===a.uid?editingCard(a):artistCard(a);}
  function editingCard(a){
    const article=el('article','artist is-editing'),info=el('div','artist-info');
    const numbers=el('div','artist-numbers');numbers.append(el('span','serial',String(seqOf(draft)).padStart(4,'0')),el('span','work-count',draft.works.length+' 张图片'));info.append(numbers);
    const field=(label,node)=>{const wrap=el('label','edit-field');wrap.append(el('span','edit-label',label),node);return wrap;};
    const fieldBox=(label,node)=>{const wrap=el('div','edit-field edit-field-wide');wrap.append(el('span','edit-label',label),node);return wrap;};
    const nameInput=el('input');nameInput.value=draft.name;nameInput.maxLength=160;nameInput.placeholder='画师名字（必填）';nameInput.oninput=()=>draft.name=nameInput.value;
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
    const descInput=el('textarea');descInput.rows=3;descInput.maxLength=5000;descInput.value=draft.description||'';descInput.placeholder='记录画风和特点';descInput.oninput=()=>draft.description=descInput.value;
    const noteInput=el('textarea');noteInput.rows=2;noteInput.maxLength=5000;noteInput.value=draft.note||'';noteInput.placeholder='备注';noteInput.oninput=()=>draft.note=noteInput.value;
    const grid=el('div','edit-grid');grid.append(field('画师名字',nameInput),field('主分类',categorySelect),field('画师页面链接',urlInput),fieldBox('标签',tagEditor));
    editorError=el('p','error');info.append(grid,field('画风描述',descInput),field('备注',noteInput),editorError);
    const actions=el('div','artist-actions');actions.append(btn('保存',saveDraft,'action primary-action'),btn('取消',cancelEdit,'action'));
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
    $('categories').replaceChildren(...['全部',...data.categories,'待判断'].map(c=>{const n=data.artists.filter(a=>c==='全部'||(c==='待判断'?!a.category:a.category===c)).length;const b=btn(c,()=>{state.category=c;render();},c===state.category?'active':'');b.setAttribute('aria-pressed',String(c===state.category));b.append(el('span','n',n));return b;}));
    $('tags').replaceChildren(...data.tags.map(t=>{const b=btn(t,()=>{state.tags.has(t)?state.tags.delete(t):state.tags.add(t);render();},state.tags.has(t)?'active':'');b.setAttribute('aria-pressed',String(state.tags.has(t)));return b;}));
    const rows=data.artists.filter(a=>(state.category==='全部'||(state.category==='待判断'?!a.category:a.category===state.category))&&[...state.tags].every(t=>a.tags.includes(t))&&a.name.toLowerCase().includes(state.query));
    if(draft&&!editingId)rows.push(draft);
    const gallery=$('gallery');gallery.classList.add('is-refreshing');ArtistGallery.render(gallery,rows,card);clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>gallery.classList.remove('is-refreshing'),260);
    $('count').textContent=`找到 ${rows.length} / ${data.artists.length} 位 · 连续滚动，按需加载${state.tags.size>1?' · 同时包含所选标签':''}`;$('empty').hidden=rows.length!==0;
    $('library-summary').textContent=`${data.artists.length} 位画师 · ${data.artists.reduce((n,a)=>n+a.works.length,0)} 张作品 · 由你自由整理`;$('sample-date').textContent=data.date?'初始样本日期：'+data.date:'';
  }
  let editorPicker=null,editorHost=null,editorError=null;
  function setEditorError(message){if(editorError)editorError.textContent=message;}
  function closeWorkPicker(){if(editorPicker){editorPicker.dispose();editorPicker=null;}if(editorHost){editorHost.replaceChildren();editorHost=null;}}
  function togglePicker(expand){
    if(editorPicker){closeWorkPicker();return;}
    const tag=(draft.name||'').trim();
    if(!tag){setEditorError('先在「画师名字」里填 Danbooru 标签，再用它去找作品。');return;}
    setEditorError('');
    editorHost=el('div','work-picker');expand.append(editorHost);
    const exclude=new Set(draft.works.map(w=>w.id).filter(Boolean));
    editorPicker=WorkPicker.mount(editorHost,{uid:draft.uid,tag,exclude,zoom:prefs,onPreview:work=>previewWork(draft.name,work,draft.uid)});
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
    const uid=draft.uid;
    requestAnimationFrame(()=>{const slot=document.querySelector('.artist-slot[data-uid="'+uid+'"]');if(slot)slot.scrollIntoView({block:'center',behavior:'smooth'});});
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
    draft=a?clone(a):{uid:uid(),name:'',category:null,tags:[],artistUrl:'',description:'',note:'',works:[]};
    if(editingId)ArtistGallery.pin(editingId,true);
    morphAway(previous||editingId,()=>{render();focusEditingCard();});
  }
  function cancelEdit(){
    if(busy||uploading)return;
    morphAway(editingId,()=>{closeEditor();render();});
  }
  function closeEditor(){if(editingId)ArtistGallery.pin(editingId,false);closeWorkPicker();editingId=null;draft=null;editorError=null;}
  async function saveDraft(){
    if(busy||uploading)return;
    const name=(draft.name||'').trim();
    if(!name){setEditorError('请填写画师名字。');return;}
    if(data.artists.some(a=>a.uid!==editingId&&a.name.toLowerCase()===name.toLowerCase())){setEditorError('已有同名画师。');return;}
    if(draft.artistUrl&&!url(draft.artistUrl)){setEditorError('画师页面链接只支持 http:// 或 https://。');return;}
    if(draft.works.some(w=>w.url&&!url(w.url))){setEditorError('作品来源链接只支持 http:// 或 https://。');return;}
    if(name!==draft.name){draft.counts=null;draft.danbooruId=null;}
    draft.name=name;draft.artistUrl=url(draft.artistUrl);draft.tags=unique(draft.tags);draft.basis='';draft.status='';draft.works.forEach(w=>w.url=url(w.url));
    const next=clone(data),i=next.artists.findIndex(a=>a.uid===editingId);
    if(i<0){draft.uid=ArtistId.issue(next.artists,{name:draft.name,danbooruId:draft.danbooruId});next.artists.push(draft);}else next.artists[i]=draft;
    next.artists.forEach((a,j)=>a.order=j+1);next.tags=unique([...next.tags,...draft.tags]);
    await new Promise(resolve=>morphAway(editingId,resolve));
    closeEditor();
    await save(next);
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
        if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(f.type)||f.size>50*1024*1024)throw Error('请选择不超过 50 MB 的 JPG、PNG、WebP、GIF 或 AVIF 图片。');
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
    try{const handle=await window.showSaveFilePicker({suggestedName:'画师库备份_'+new Date().toISOString().slice(0,10)+'.json',types:[{description:'画师库 JSON',accept:{'application/json':['.json']}}]});busy=true;controls.forEach(([e])=>e.disabled=true);stream=await handle.createWritable();await FolderStore.exportTo(folder,data,stream,(i,n)=>status(`正在导出 ${i} / ${n} 位画师…`));await stream.close();stream=null;status('备份已保存，包含本地缩略图与原图；未下载的原图保留在线链接。');
    }catch(error){if(stream)await stream.abort().catch(()=>{});if(error.name!=='AbortError')status('备份失败：'+error.message,true);}finally{busy=false;controls.forEach(([e,disabled])=>e.disabled=disabled);}
  }
  async function importData(e){
    const f=e.target.files[0];e.target.value='';if(!f||busy)return;
    try{if(f.size>100*1024*1024)throw Error('超过 100 MB 的备份请使用完整「数据」文件夹恢复，避免一次解析全部图片占满内存。');const next=normalize(JSON.parse(await f.text()),true);if(next.artists.some(a=>a.works.some(w=>FolderStore.imageOf(w,'thumb')?.kind==='local')))throw Error('这份 JSON 未包含图片，请直接选择对应数据文件夹。');if(!confirm(`用备份中的 ${next.artists.length} 位画师替换当前 ${data.artists.length} 位？建议先导出当前备份。`))return;reset();await save(next,'已导入备份');ArtistImages.clear();}catch(error){alert('导入失败。\n'+error.message);}
  }
  const BATCH_CHUNK=25,BATCH_WORKS=3;
  let batchStop=false;const batchFailed=[];
  async function enrichArtists(names){
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
          const detail=await ArtistLookup.details(name,next.cutoffDate,{previews:true});
          if(detail.countsError)throw Error('作品数量读取失败');
          let id=null;
          try{const found=await ArtistLookup.lookup(ArtistLookup.plan(name)),exact=found.filter(c=>c.name.toLowerCase()===name.toLowerCase());id=exact.length===1?exact[0].id:(found.length===1?found[0].id:null);}catch{}
          const parsed=ArtistId.parse(artist.uid);
          if(id!==null){artist.danbooruId=id;artist.uid=ArtistId.create({seq:parsed?parsed.seq:artist.order,name,danbooruId:id});renamed++;}
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
  async function batch(e){
    e.preventDefault();if(busy)return;const names=unique($('batch-names').value.split(/\r?\n/));if(!names.length)return;if(names.some(n=>n.length>160)){$('batch-message').textContent='名字不能超过 160 个字符，请检查是否每行一位。';return;}
    const collect=$('batch-works').checked;
    const next=clone(data),seen=new Set(next.artists.map(a=>a.name.toLowerCase())),added=[];let count=0;
    for(const name of names){if(seen.has(name.toLowerCase()))continue;seen.add(name.toLowerCase());if(next.artists.length>=20000){$('batch-message').textContent='最多支持 20,000 位画师。';return;}next.artists.push({uid:ArtistId.issue(next.artists,{name}),order:next.artists.length+1,name,category:null,tags:[],artistUrl:'https://danbooru.donmai.us/posts?tags='+encodeURIComponent(name),description:'',note:'',works:[]});added.push(name);count++;}
    batchStop=false;batchFailed.length=0;
    reset();await save(next,`已添加 ${count} 位，跳过 ${names.length-count} 个重复名字`);
    const summary=`已添加 ${count} 位，跳过 ${names.length-count} 个重复名字`;
    if(collect&&added.length){
      $('batch-message').textContent=`开始采集 ${added.length} 位画师的最新 ${BATCH_WORKS} 张作品…`;
      const result=await enrichArtists(added);
      $('batch-message').textContent=`${summary}。采集 ${result.done} 位 · 补编号 ${result.renamed} · 缩略图 ${result.images} 张${result.failed?` · 失败 ${result.failed}（${batchFailed.join('；')}）`:''}${batchStop?' · 已中止，再次提交同一名单会跳过已采集的画师':''}。`;
    }else $('batch-message').textContent=summary+'。';
    if($('batch-dialog').open&&!batchStop)$('batch-dialog').close();
  }
  let lookupTimer,lookupController,lookupSequence=0;
  async function checkExtension(){try{const version=await ArtistExtension.check();$('extension-status').textContent='图片助手已连接 · '+version;$('extension-status').title='扩展取图可用';ArtistImages.clear();}catch(error){$('extension-status').textContent='图片助手未连接 · 点击重试';$('extension-status').title=error.message;status(error.message,true);}}
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
      if(artist.aliases.length)detail.append(el('small','',`别名：${artist.aliases.join('、')}`));detail.append(link('核对画师资料 ↗',artist.pageUrl));
      const countLine=el('small','','作品数量：读取中…');detail.append(countLine);
      const body=el('div','candidate-body');detail.append(body);
      const previewUid='preview-'+artist.id;
      const picker=WorkPicker.mount(body,{uid:previewUid,tag:artist.name,zoom:prefs,onPreview:work=>previewWork(artist.name,work,previewUid)});activePickers.push(picker);
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
      },'action primary-action');add.disabled=exists();picker.tools.append(add);row.append(detail);$('quick-results').append(row);
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
    applyCardSize();
    data=normalize(FolderStore.empty());status('请先选择「数据」文件夹，读取或开始整理画师库。');
    ArtistTestImages.init({getData:()=>data,getBusy:()=>busy,readImage,thumbnail,save});
    $('test-import-open').onclick=()=>ArtistTestImages.open();$('close-test-import').onclick=()=>$('test-import').close();$('test-cancel').onclick=()=>$('test-import').close();
    $('test-files').onchange=e=>{ArtistTestImages.files=[...e.target.files];ArtistTestImages.refresh();};
    $('test-start').oninput=()=>ArtistTestImages.refresh();$('test-seq').oninput=()=>ArtistTestImages.refresh();$('test-run').onclick=()=>ArtistTestImages.runImport();
    $('test-remove-all').onclick=()=>{for(const box of $('test-remove-list').querySelectorAll('input[type=checkbox]'))box.checked=true;};
    $('test-remove-none').onclick=()=>{for(const box of $('test-remove-list').querySelectorAll('input[type=checkbox]'))box.checked=false;};
    $('test-remove-run').onclick=()=>ArtistTestImages.runRemove();
    $('settings-open').onclick=()=>{$('history-date').value=data.cutoffDate;$('save-large').checked=data.saveLargeImages===true;$('card-size').value=String(prefs.cardSize);$('card-size-value').textContent=prefs.cardSize;$('settings').showModal();};$('close-settings').onclick=()=>$('settings').close();
    $('card-size').oninput=()=>{const value=Number($('card-size').value);$('card-size-value').textContent=value;prefs.setCardSize(value);};
    $('save-large').onchange=async()=>{const next=clone(data);next.saveLargeImages=$('save-large').checked;await save(next,next.saveLargeImages?'已开启「保存大图」：预览作品时会保存原图':'已关闭「保存大图」：预览作品时不再保存原图');};
    $('history-date').onchange=async()=>{const date=$('history-date').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ $('history-date').value=data.cutoffDate;return;}const next=clone(data);next.cutoffDate=date;await save(next,'已保存截至日期；点击画师旁的刷新后，该画师数量才会更新。');};
    $('add-artist').onclick=()=>startEdit(null);$('quick-form').onsubmit=e=>{e.preventDefault();detectArtist();};$('quick-input').oninput=quickChanged;$('quick-input').oncompositionend=quickChanged;
    $('quick-manual').onclick=()=>{cancelLookup();startEdit(null);const value=$('quick-input').value.trim();if(value&&draft){try{const p=ArtistLookup.plan(value);if(p.kind==='name')draft.name=p.query;else if(p.kind==='url')draft.artistUrl=p.query;render();}catch{}}};
    $('manage-tags').onclick=()=>{if(!busy){manageFilter.category='';manageFilter.tag='';$('category-search').value='';$('tag-search').value='';showManageTab('category');listCategories();listTags();$('tag-manager').showModal();}};$('close-tags').onclick=()=>$('tag-manager').close();
    $('tab-category').onclick=()=>showManageTab('category');$('tab-tag').onclick=()=>showManageTab('tag');
    $('category-search').oninput=e=>{manageFilter.category=e.target.value.trim().toLowerCase();listCategories();};
    $('tag-search').oninput=e=>{manageFilter.tag=e.target.value.trim().toLowerCase();listTags();};
    $('category-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const name=$('new-category').value.trim();if(!name)return;if(data.categories.includes(name)){alert('这个分类已存在。');return;}const next=clone(data);next.categories.push(name);await save(next);$('new-category').value='';listCategories();};$('tag-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const t=$('new-tag').value.trim();if(!t)return;if(data.tags.includes(t)){alert('这个标签已存在。');return;}const next=clone(data);next.tags.push(t);await save(next);$('new-tag').value='';listTags();};
    $('batch-artists').onclick=()=>{if(busy)return;$('batch-names').value='';$('batch-message').textContent='';$('batch-dialog').showModal();};$('close-batch').onclick=()=>$('batch-dialog').close();$('batch-dialog').addEventListener('close',()=>{batchStop=true;});$('batch-form').onsubmit=batch;$('names-file').onchange=async e=>{try{const f=e.target.files[0];if(f){if(f.size>5*1024*1024)throw Error('TXT 名单不能超过 5 MB。');$('batch-names').value=await f.text();}}catch(error){$('batch-message').textContent=error.message;}finally{e.target.value='';}};
    $('export-data').onclick=exportData;$('import-data').onclick=()=>{if(!busy)$('import-file').click();};$('import-file').onchange=importData;
    let searchTimer;$('search').oninput=e=>{state.query=e.target.value.trim().toLowerCase();clearTimeout(searchTimer);searchTimer=setTimeout(render,150);};$('reset').onclick=()=>{reset();render();};$('close-viewer').onclick=()=>$('viewer').close();
    ArtistViewer.init({getData:()=>data,getFolder:()=>folder,save,notify:status});
    $('viewer').addEventListener('close',()=>{ArtistImages.dispose('viewer');ArtistViewer.dispose();});$('save-original').onclick=()=>ArtistViewer.saveOriginal();
    document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();}));
    $('extension-status').onclick=checkExtension;
    window.addEventListener('beforeunload',e=>{if(volatile||busy){e.preventDefault();e.returnValue='';}});render();document.querySelectorAll('button,input,textarea,select').forEach(b=>b.disabled=true);$('choose-folder').disabled=false;$('extension-status').disabled=false;$('choose-folder').onclick=connectFolder;checkExtension();
  }
  init();
})();
