(function(root){
  'use strict';
  const PAGE_SIZE=21;
  let instance=0;
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const btn=(text,fn,cls='action')=>{const node=el('button',cls,text);node.type='button';node.onclick=fn;return node;};
  // 页码基于排除已收录作品后的结果；仅当前页绑定图片，选择状态独立于页面。
  /* preset 是「一开始就算已经选中的那些」。编辑已有画师时把作品列表传进来，
     于是候选区里它们保持勾选状态、带「已加入」标记，取消勾选就是真的移出——
     不能像以前那样把这些作品整个过滤掉：那样用户看不到、也取消不了自己刚勾的那些。 */
  function mount(container,{uid,tag,exclude,preset,onPreview=()=>{},order='id_desc',orderOptions=[],onAdd=null,onRemove=null,onOrderChanged,onAlign=null}={}){
    const group='picker:'+uid+':'+(++instance),immediate=typeof onAdd==='function',excluded=new Set([...(exclude||[])].map(String));
    const status=el('div','picker-status'),message=el('small','picker-message','正在读取作品…'),counter=el('small','picker-count');
    message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    const grid=el('div','candidate-previews');grid.tabIndex=-1;grid.setAttribute('aria-label',tag+' 的候选作品，每页三行七列');
    const orderBar=el('label','picker-order'),orderSelect=el('select');orderSelect.setAttribute('aria-label','作品排序');
    orderSelect.append(...orderOptions.map(option=>{const node=el('option','',option.label);node.value=option.value;return node;}));orderSelect.value=order;
    orderBar.append(el('span','','排序'),orderSelect);
    const pages=el('nav','picker-pagination');pages.setAttribute('aria-label','作品分页');
    const previous=btn('← 上一页',()=>go(page-1,true)),next=btn('下一页 →',()=>go(page+1,true)),pageLabel=el('span','picker-page','第 1 页');
    previous.title='上一页：A / ←';next.title='下一页：D / →';pageLabel.setAttribute('aria-live','polite');
    pages.append(previous,pageLabel,next);
    const retry=btn('重试',()=>go(failedPage,true,failedOrder));retry.hidden=true;
    if(orderOptions.length)status.append(orderBar);status.append(pages,counter,retry,message);container.append(status,grid);
    const picked=new Map((preset||[]).filter(work=>work&&work.id!=null).map(work=>[String(work.id),work]));
    let query={order,buffer:[],seen:new Set(),sourcePage:1,exhausted:false},works=[],page=1,loading=false,disposed=false,revision=0,controller=null,failedPage=1,failedOrder=order,focusTimer=null;
    const update=()=>{
      const total=query.exhausted?Math.max(1,Math.ceil(query.buffer.length/PAGE_SIZE)):null;
      pageLabel.textContent=total?'第 '+page+' / '+total+' 页':'第 '+page+' 页';
      previous.disabled=loading||page<=1;next.disabled=loading||(query.exhausted&&page*PAGE_SIZE>=query.buffer.length);
      orderSelect.disabled=false;retry.disabled=loading;
      counter.textContent=(immediate?'已加入 ':'已选 ')+picked.size+' 张 · 本页 '+works.length+' 张';grid.setAttribute('aria-busy',String(loading));
    };
    /* 视线落点交给调用方：编辑态要交回画师作品格，快捷识别区没有作品格，就还是对准自己。
       mode 就是 scrollIntoView 的 block：'start' 顶部对齐，'nearest' 只在看不见时才拉回来。 */
    const focus=(mode='nearest')=>{
      if(disposed)return;grid.focus?.({preventScroll:true});
      const reveal=behavior=>{if(typeof onAlign==='function')onAlign(mode);else container.scrollIntoView?.({block:mode,behavior});};
      reveal(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth');
      // 图片和虚拟卡片挂载会改变滚动目标，结束后只在焦点仍在作品区时校准一次。
      if(typeof setTimeout==='function'){clearTimeout(focusTimer);focusTimer=setTimeout(()=>{if(!disposed&&(document.activeElement===grid||grid.contains?.(document.activeElement)))reveal('auto');},420);}
    };
    async function toggle(work,box,label,want){
      if(loading||disposed){box.checked=picked.has(String(work.id));return;}
      const id=String(work.id);box.disabled=true;update();
      try{
        if(immediate){if(want)await onAdd(work);else await onRemove?.(work);}
        if(disposed)return;
        if(want)picked.set(id,work);else picked.delete(id);
        label.classList.toggle('is-added',immediate&&want);
        message.textContent=immediate?(want?'已加入 #'+id+'，保存画师后写入资料库。':'已移出 #'+id+'。'):'已更新选择。';
      }catch(error){if(!disposed){box.checked=!want;message.textContent=(want?'加入失败：':'移出失败：')+error.message;}}
      finally{if(!disposed){box.disabled=false;update();}}
    }
    const item=work=>{
      const label=el('label','pick'),box=el('input'),img=el('img');box.type='checkbox';box.checked=picked.has(String(work.id));box.setAttribute('aria-label','选择作品 #'+work.id);
      img.alt=tag+' #'+work.id;ArtistImages.bind(img,uid,work,group,'thumb',error=>{label.title=error.message;});
      label.append(box,img,btn('#'+work.id,()=>onPreview(work),'pick-id'));box.onchange=()=>toggle(work,box,label,box.checked);
      if(immediate&&box.checked)label.classList.add('is-added');return label;
    };
    const render=()=>{
      ArtistImages.dispose(group);const cells=works.map(item);
      while(cells.length<PAGE_SIZE){const blank=el('div','picker-placeholder');blank.setAttribute('aria-hidden','true');cells.push(blank);}
      grid.replaceChildren(...cells);update();
    };
    async function go(target,moveFocus=false,nextOrder=query.order){
      if(disposed||target<1)return;
      const request=++revision;controller?.abort();controller=typeof AbortController==='function'?new AbortController():null;
      const candidate=nextOrder===query.order?query:{order:nextOrder,buffer:[],seen:new Set(),sourcePage:1,exhausted:false};
      loading=true;failedPage=target;failedOrder=nextOrder;retry.hidden=true;message.textContent='正在读取第 '+target+' 页…';update();
      try{
        // 按需补足一页；不将全库图片一次性取回，末页不足 21 张时保留空位。
        while(candidate.buffer.length<target*PAGE_SIZE&&!candidate.exhausted){
          const batch=await ArtistLookup.posts(tag,{limit:PAGE_SIZE,page:candidate.sourcePage,order:nextOrder,signal:controller?.signal});
          if(disposed||request!==revision)return;
          candidate.sourcePage++;candidate.exhausted=batch.length<PAGE_SIZE;
          const seenBefore=candidate.seen.size;for(const work of batch){const id=String(work.id);if(!candidate.seen.has(id)){candidate.seen.add(id);if(!excluded.has(id))candidate.buffer.push(work);}}
          if(candidate.seen.size===seenBefore)candidate.exhausted=true;
        }
        if(disposed||request!==revision)return;
        query=candidate;orderSelect.value=nextOrder;
        page=Math.min(target,Math.max(1,Math.ceil(query.buffer.length/PAGE_SIZE)));
        works=query.buffer.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);render();
        message.textContent=works.length?(target>page?'已到最后一页。':(immediate?'勾选即加入，保存画师后写入资料库。':'勾选需要保存的作品。'))+' 点编号查看原图。':'没有可添加的新作品。';
        if(nextOrder!==order){order=nextOrder;onOrderChanged?.();}
        if(moveFocus)focus();
      }catch(error){if(!disposed&&request===revision&&error.name!=='AbortError'){orderSelect.value=query.order;message.textContent='作品读取失败：'+error.message;retry.hidden=false;}}
      finally{if(!disposed&&request===revision){loading=false;update();}}
    }
    orderSelect.onchange=()=>go(1,true,orderSelect.value);
    container.addEventListener?.('keydown',event=>{
      if(event.isComposing||event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||event.target?.closest?.('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=true]'))return;
      const key=event.key.toLowerCase();if(!['a','d','arrowleft','arrowright'].includes(key))return;
      event.preventDefault();event.stopPropagation();if(loading)return;
      const delta=key==='a'||key==='arrowleft'?-1:1;if((delta<0&&previous.disabled)||(delta>0&&next.disabled))return;go(page+delta,true);
    });
    render();const ready=go(1);
    return {ready,tools:status,focus,selected:()=>[...picked.values()],added:()=>[...picked.keys()],
      /* 外部把某件作品从作品列表里删掉之后调它：就地取消那一格的勾选与「已加入」标记。
         只改这一个格子，不重画整页——重画会把候选列表的滚动位置和已经加载好的图片一起冲掉。
         这里**不能先看 picked 里有没有它**：用户从作品格删掉时，onRemove 已经把 id 从 picked 里删了，
         再去查就等于什么都没做（那一格还勾着，用户看到"删了还在"）。
         定位用格子里那枚「#编号」文本——它就是这一格的标识，比 aria 属性更直接。 */
      syncRemoved(id){
        const key=String(id),wanted='#'+key;picked.delete(key);
        for(const label of grid.children||[]){
          if(!String(label.className||'').split(/\s+/).includes('pick'))continue;
          const mark=label.children?.[2];
          if(String(mark?.textContent??'')!==wanted)continue;
          const box=label.children?.[0];
          if(box)box.checked=false;
          label.classList.remove('is-added');update();break;
        }
      },
      dispose(){disposed=true;revision++;if(typeof clearTimeout==='function')clearTimeout(focusTimer);controller?.abort();ArtistImages.dispose(group);container.replaceChildren();}};
  }
  root.WorkPicker={mount};
})(globalThis);
