/* 工作台只管理导航与呈现。数据写入和任务生命周期仍由 app 协调。 */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),history=[],calm=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 const commands=[['choose-folder','连接 / 切换数据文件夹','资料库'],['quick-open','识别并添加画师','添加'],['add-artist','手动添加画师','添加'],['batch-artists','批量采集画师','采集'],['manage-tags','管理分类与标签','整理'],['settings-open','资料库设置','设置'],['gen-settings-open','NovelAI 生图参数','生成'],['test-import-open','导入测试风格图','导入'],['gen-batch-open','批量生成测试风格图','生成'],['export-data','导出资料备份','备份'],['import-data','恢复资料备份','备份'],['status-toggle','查看本次活动记录','状态']];
 let connected=false,total=0,commandIndex=0,commandItems=[],initialized=false;
 const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 function closeMenus(){document.querySelectorAll('.action-menu[open]').forEach(menu=>menu.open=false);}
 function openQuick(){if(!$('quick-dialog').open)$('quick-dialog').showModal();$('quick-input').focus();}
 function status(message,error){
  if(!message||history[0]?.message===message)return;
  history.unshift({message,error,time:new Date()});if(history.length>80)history.length=80;
  if($('activity-dialog').open)paintHistory();
 }
 function paintHistory(){
  $('activity-list').replaceChildren(...history.map(entry=>{const li=element('li',undefined,entry.error?'error':'');const time=element('time',entry.time.toLocaleTimeString('zh-CN',{hour12:false}));time.dateTime=entry.time.toISOString();li.append(time,element('span',entry.message));return li;}));
 }
 function paintCommands(){
  const query=$('command-search').value.trim().toLowerCase();commandItems=commands.filter(([,label,group])=>(label+' '+group).toLowerCase().includes(query));commandIndex=0;
  $('command-results').replaceChildren(...commandItems.map(([id,label,group])=>{const button=element('button');button.type='button';button.append(element('span',label),element('small',group));button.disabled=$(id).disabled;button.onclick=()=>{$('command-dialog').close();$(id).click();};return button;}));
  if(!commandItems.length)$('command-results').append(element('p','没有匹配的操作','field-help'));
 }
 function openCommands(){closeMenus();$('command-search').value='';paintCommands();$('command-dialog').showModal();$('command-search').focus();}
 function captureFilterFocus(){
  const active=document.activeElement,key=active?.dataset?.filterKey,parent=active?.parentElement?.id;
  if(!key||!['categories','tags','scores','active-filters'].includes(parent))return ()=>{};
  return ()=>{const next=[...$(parent).querySelectorAll('button')].find(node=>node.dataset.filterKey===key);(next||$('search')).focus({preventScroll:true});};
 }
 function update({connected:hasFolder,total:count,rows,category,editing,tasks,filterCount=0}){
  connected=hasFolder;total=count;
  $('filter-number').textContent=String(filterCount);$('filter-number').hidden=!filterCount;
  $('connection-dot').classList.toggle('connected',connected);$('choose-folder').textContent=connected?'切换资料库':'打开资料库';
  $('task-controls').hidden=!tasks;$('task-label').textContent=tasks||'后台任务进行中';
  if(rows||editing)return;
  $('empty-title').textContent=!connected?'让喜欢的画风，有迹可循':total?'没有符合条件的画师':'开始建立你的画风收藏';
  $('empty-description').textContent=!connected?'选择已有数据文件夹，或用空文件夹开始整理。资料和图片保存在你的电脑上。':total?'换个关键词、减少标签或清除筛选，即可继续浏览。':'粘贴画师名字或主页链接来识别添加，也可以使用批量采集。';
  $('empty-action').textContent=!connected?'打开数据文件夹':total?'清除全部筛选':'识别添加画师';
 }
 function init({saveEditor}){
  if(initialized)return;initialized=true;
  const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');motionPreference.addEventListener('change',event=>{if(event.matches)document.getAnimations().forEach(animation=>animation.cancel());});
  const densityKey='artist-library.density';
  const setDensity=value=>{const compact=value==='compact';document.documentElement.dataset.density=compact?'compact':'comfortable';$('density-toggle').setAttribute('aria-pressed',String(compact));$('density-toggle').textContent=compact?'舒适视图':'紧凑视图';};
  try{setDensity(localStorage.getItem(densityKey));}catch{setDensity('comfortable');}
  $('density-toggle').onclick=()=>{const value=document.documentElement.dataset.density==='compact'?'comfortable':'compact';const relayout=window.ArtistGallery?.animateLayoutChange;relayout?relayout(()=>setDensity(value)):setDensity(value);try{localStorage.setItem(densityKey,value);}catch{}};
  $('quick-open').onclick=openQuick;$('empty-action').onclick=()=>$( !connected?'choose-folder':total?'reset':'quick-open').click();
  $('status-toggle').onclick=()=>{paintHistory();$('activity-dialog').showModal();};$('back-top').onclick=()=>window.scrollTo({top:0,behavior:calm()?'auto':'smooth'});
  $('filter-toggle').onclick=()=>{const open=$('filter-panel').hidden;$('filter-panel').hidden=!open;$('filter-toggle').setAttribute('aria-expanded',String(open));};
  const themeKey='artist-library.appearance';
  const setTheme=value=>{const light=value==='light';document.documentElement.dataset.theme=light?'light':'dark';$('theme-toggle').setAttribute('aria-label',light?'切换深色外观':'切换浅色外观');$('theme-toggle').title=light?'切换深色外观':'切换浅色外观';};
  try{setTheme(localStorage.getItem(themeKey));}catch{setTheme('dark');}
  $('theme-toggle').onclick=()=>{const value=document.documentElement.dataset.theme==='light'?'dark':'light';setTheme(value);try{localStorage.setItem(themeKey,value);}catch{}};
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>window.ArtistGallery.remeasure?.(),180);});
  $('command-open').onclick=openCommands;$('command-search').oninput=paintCommands;
  $('command-dialog').addEventListener('keydown',event=>{
   if(event.isComposing)return;const items=[...$('command-results').querySelectorAll('button:not(:disabled)')];if(!items.length)return;
   if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const current=items.indexOf(document.activeElement);commandIndex=current<0?(event.key==='ArrowDown'?0:items.length-1):(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[commandIndex].focus();}
   else if(event.key==='Enter'&&event.target===$('command-search')){event.preventDefault();items[0].click();}
  });
  document.addEventListener('keydown',event=>{
   if(event.isComposing||event.defaultPrevented)return;
   const modal=document.querySelector('dialog[open]'),editable=event.target.closest('input,textarea,select,[contenteditable=true]');
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!modal){event.preventDefault();openCommands();return;}
   if(event.key==='Escape'&&!modal){const menu=document.querySelector('.action-menu[open]');if(menu){event.preventDefault();menu.open=false;menu.querySelector('summary').focus();}else if(!$('filter-panel').hidden){event.preventDefault();$('filter-panel').hidden=true;$('filter-toggle').setAttribute('aria-expanded','false');$('filter-toggle').focus();}return;}
   if(modal)return;
   if(event.key==='/'&&!editable&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();$('search').focus();$('search').select();}
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&document.querySelector('.is-editing')){event.preventDefault();saveEditor();}
  });
  document.querySelectorAll('dialog').forEach(dialog=>{
   dialog.querySelectorAll('[data-close-dialog]').forEach(button=>button.onclick=()=>dialog.close());
   // 只有真正点到遮罩才关闭；点击内容内的空隙不算。拖拽从弹窗内部结束在遮罩上也不关闭。
   let outside=false;
   const isOutside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;};
   dialog.addEventListener('pointerdown',event=>outside=event.target===dialog&&isOutside(event));
   dialog.addEventListener('click',event=>{if(outside&&event.target===dialog&&isOutside(event))dialog.close();outside=false;});
  });
  document.querySelectorAll('.upload-label').forEach(label=>{label.tabIndex=0;label.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();label.querySelector('input[type=file]')?.click();}});});
  document.addEventListener('toggle',event=>{const menu=event.target;if(menu.matches?.('.action-menu')&&menu.open)document.querySelectorAll('.action-menu[open]').forEach(other=>{if(other!==menu)other.open=false;});},true);
  document.addEventListener('click',event=>{const action=event.target.closest('.menu-panel button');if(!event.target.closest('.action-menu')||(action&&!action.classList.contains('is-armed')))closeMenus();});
  const tabs=[$('tab-category'),$('tab-tag')];tabs.forEach((tab,index)=>tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-index;tabs[next].click();tabs[next].focus();}));
  for(const id of ['choose-folder','extension-status','empty-action','filter-toggle','theme-toggle','density-toggle','sort-direction','command-open','command-search','status-toggle','back-top','search','library-sort','reset'])$(id).disabled=false;
  document.querySelectorAll('[data-close-dialog]').forEach(button=>button.disabled=false);
 }
 window.ArtistWorkspace={init,update,status,openQuick,captureFilterFocus};
})();
