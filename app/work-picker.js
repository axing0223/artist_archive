(function(root){
  'use strict';
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const btn=(text,fn,cls='action')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
  const LIMIT=20,DEFAULT_ZOOM={thumbHeight:120,setThumbHeight(){},subscribe(){},unsubscribe(){}};
  /* 两种用法：
     给了 onAdd —— 勾上即加入（编辑画师时用），取消勾选就移出，全程不重画整张卡片；
     没给 onAdd —— 只负责勾选（快捷识别里给「添加此画师」用），选中哪些由调用方自己取。
     列表本身只追加、不整体重建——重建会让已经读出来的图全部重新淡入一遍，看着就是整屏闪一下；
     只追加的话，新读到的那几张会各自淡入，正好是「加载出来」该有的样子。 */
  function mount(container,{uid,tag,exclude,onPreview=()=>{},zoom=DEFAULT_ZOOM,limit=LIMIT,order='id_desc',orderOptions=[],onAdd=null,onRemove=null,onOrderChanged}={}){
    const group='picker:'+uid,immediate=typeof onAdd==='function';
    const status=el('small','picker-status','正在读取作品…'),grid=el('div','candidate-previews'),tools=el('div','candidate-tools'),counter=el('small','');
    const zoomBar=el('div','picker-zoom'),range=el('input');
    range.type='range';range.min='70';range.max='220';range.step='10';range.value=String(zoom.thumbHeight);range.title='调整作品预览的大小';
    range.oninput=()=>zoom.setThumbHeight(Number(range.value));
    zoomBar.append(el('small','','预览大小'),range);
    container.append(status,grid,tools);
    const applyZoom=value=>{const size=value||zoom.thumbHeight;grid.style.setProperty('--pick-size',size+'px');range.value=String(size);};
    zoom.subscribe(applyZoom);applyZoom();
    const picked=new Set(),items=new Map();
    let works=[],page=1,exhausted=false,disposed=false,bulking=false;
    const skipped=()=>exclude&&exclude.size?` · 库中已有的 ${exclude.size} 张不会再列出`:'';
    const updateCount=()=>{counter.textContent=`${immediate?'已加入':'已选'} ${picked.size} / ${immediate?'本页 ':''}${works.length} 张${exhausted?'':' · 还有更多'}${skipped()}`;};
    const mark=(id,on)=>{const label=items.get(id);if(!label)return;const box=label.children[0];if(box)box.checked=on;if(immediate)label.classList.toggle('is-added',on);};
    /* 勾选 = 加入（有 onAdd 时）。失败要把勾选退回去，不能让人以为加上了。 */
    async function toggle(work,box,label,want){
      if(!immediate){if(want)picked.add(work.id);else picked.delete(work.id);updateCount();return;}
      if(bulking){box.checked=!want;return;}
      box.disabled=true;
      const what='#'+work.id;
      status.textContent=want?`正在把 ${what} 的预览图存进这本画师…`:`正在把 ${what} 移出…`;
      try{
        if(want){await onAdd(work);picked.add(work.id);label.classList.add('is-added');status.textContent=`已加入 ${what}。点「保存」才会写进画师目录。`;}
        else{await onRemove(work);picked.delete(work.id);label.classList.remove('is-added');status.textContent=`已把 ${what} 移出。`;}
      }catch(error){box.checked=!want;status.textContent=(want?'加入失败：':'移出失败：')+error.message;}
      finally{box.disabled=false;updateCount();}
    }
    /* 一格候选作品。已经加入过的（换排序之后又出现的）直接把勾打上。 */
    const makeItem=work=>{
      const label=el('label','pick'),box=el('input');box.type='checkbox';box.checked=picked.has(work.id);
      const img=el('img');img.alt=tag+' #'+work.id;img.width=90;
      ArtistImages.bind(img,uid,work,group,'thumb',error=>{label.title=error.message;});
      label.append(box,img,btn('#'+work.id,()=>onPreview(work),'pick-id'));
      box.onchange=()=>toggle(work,box,label,box.checked);
      if(immediate&&picked.has(work.id))label.classList.add('is-added');
      items.set(work.id,label);return label;
    };
    /* 只补新来的：已经在列表里的格子一个都不动。 */
    const render=()=>{const fresh=works.filter(work=>!items.has(work.id));if(fresh.length)grid.append(...fresh.map(makeItem));updateCount();};
    const loadMore=async()=>{
      const batch=await ArtistLookup.posts(tag,{limit,page,order});
      if(disposed)return works.length;
      if(batch.length<limit)exhausted=true;
      const fresh=batch.filter(w=>!exclude||!exclude.has(w.id));
      works=works.concat(fresh);page++;
      render();return works.length;
    };
    const more=btn('加载更多',async()=>{
      more.disabled=true;more.textContent='正在读取…';
      try{status.textContent=`已读取 ${await loadMore()} 张作品`;}
      catch(error){status.textContent='读取失败：'+error.message;}
      finally{more.disabled=false;more.textContent='加载更多';more.hidden=exhausted;}
    });
    const orderBar=el('div','picker-order'),orderSelect=el('select');
    const orderLabel=()=>orderOptions.find(option=>option.value===order)?.label||order;
    orderSelect.setAttribute('aria-label','作品排序');
    orderSelect.replaceChildren(...orderOptions.map(option=>new Option(option.label,option.value)));
    orderSelect.value=order;
    orderSelect.onchange=async()=>{
      order=orderSelect.value;
      /* 换排序先不动眼前这张列表：清空会让页面突然变矮、滚动位置跟着跳，二十张图也要重来一遍。
         新的一批读回来了再整体换掉，已经加入的那些照旧打着勾。 */
      status.textContent='正在按新排序读取作品…';
      more.disabled=true;
      try{
        const batch=await ArtistLookup.posts(tag,{limit,page:1,order});
        if(disposed)return;
        works=batch.filter(w=>!exclude||!exclude.has(w.id));page=2;exhausted=batch.length<limit;
        items.clear();grid.replaceChildren();render();more.hidden=exhausted;
        status.textContent=`已按「${orderLabel()}」读取 ${works.length} 张作品。`;
        onOrderChanged?.();
      }catch(error){status.textContent='读取失败：'+error.message;}
      finally{more.disabled=false;}
    };
    orderBar.append(el('small','','排序'),orderSelect);
    tools.append(zoomBar);
    if(orderOptions.length)tools.append(orderBar);
    /* 全选 / 全不选：有 onAdd 时是「全部加入 / 全部移出」，否则只是把勾一次性打上或清掉。 */
    const bulk=async want=>{
      if(bulking)return;
      const todo=works.filter(work=>want?!picked.has(work.id):picked.has(work.id));
      if(!todo.length){status.textContent=immediate?(want?'这一页都已经在列表里了。':'这一页还没有加入过的作品。'):'这一页没有可勾选的作品。';return;}
      if(!immediate){for(const work of todo){if(want)picked.add(work.id);else picked.delete(work.id);mark(work.id,want);}updateCount();return;}
      bulking=true;addAll.disabled=true;clearAll.disabled=true;
      try{
        let done=0;
        for(const work of todo){
          status.textContent=`正在${want?'加入':'移出'} ${++done} / ${todo.length} 张…`;
          if(want)await onAdd(work);else await onRemove(work);
          if(want)picked.add(work.id);else picked.delete(work.id);
          mark(work.id,want);updateCount();
        }
        status.textContent=`已${want?'加入':'移出'} ${todo.length} 张。${want?'点「保存」才会写进画师目录。':''}`;
      }catch(error){status.textContent=(want?'加入失败：':'移出失败：')+error.message;}
      finally{bulking=false;addAll.disabled=false;clearAll.disabled=false;updateCount();}
    };
    const addAll=btn('全选',()=>bulk(true)),clearAll=btn('全不选',()=>bulk(false));
    tools.append(counter,addAll,clearAll,more);
    const ready=loadMore().then(total=>{status.textContent=total?`找到 ${total} 张作品：${immediate?'勾选即加入这本画师的作品':'勾选要保存的作品'}，点编号可放大查看。`:'没有可添加的新作品。';})
      .catch(error=>{status.textContent='作品读取失败：'+error.message;});
    return {
      ready,
      tools,
      /* 勾上的那些作品。有 onAdd 时它们已经进了画师列表；没有时留给调用方自己取。 */
      selected(){return works.filter(work=>picked.has(work.id));},
      added(){return [...picked];},
      dispose(){disposed=true;zoom.unsubscribe(applyZoom);ArtistImages.dispose(group);container.replaceChildren();},
    };
  }
  root.WorkPicker={mount};
})(globalThis);
