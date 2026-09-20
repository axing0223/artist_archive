(() => {
  let observer,resize,current=[],make=null,keyOf=null,patch=null,uids=[];
  const mounted=new Map(),heights=new Map(),pinned=new Set(),slots=new Map(),painted=new Map(),near=new Set();
  /* 系统里关了动效就一个都不放，宁可少点花活也别让人难受。 */
  const calm=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* 一张卡片的「指纹」：指纹没变就不重画。重画会连图片一起重新取、重新淡入，
     那正是「随便动一下就整屏闪一下」的来源——保存、生图状态变化、搜索框敲字都会走到这里。 */
  const keyFor=artist=>keyOf?keyOf(artist):JSON.stringify(artist);
  function clear(){observer?.disconnect();resize?.disconnect();for(const id of mounted.keys())ArtistImages.dispose('card:'+id);for(const slot of slots.values())slot.remove();mounted.clear();slots.clear();painted.clear();heights.clear();pinned.clear();near.clear();uids=[];current=[];make=null;keyOf=null;patch=null;observer=null;resize=null;}
  /* 需要的时候才重画这一张。 */
  function paint(slot){
    const uid=slot.dataset.uid,artist=current[Number(slot.dataset.index)];
    if(!artist||!make)return false;
    const key=keyFor(artist);
    if(painted.get(uid)===key)return false;
    if(!patch?.(slot.children[0],artist)){ArtistImages.dispose('card:'+uid);slot.replaceChildren(make(artist));}
    mounted.set(uid,artist);painted.set(uid,key);return true;
  }
  /* 立刻按卡片真实高度挂载。render() 重建占位用的是上一次量到的高度，
     刚加完作品会比旧高度高，照着旧占位滚动会落到错的位置。 */
  function mountSlot(slot){
    if(!slot)return false;
    const id=slot.dataset.uid;
    if(mounted.has(id))return true;
    const artist=current[Number(slot.dataset.index)];
    if(!artist||!make)return false;
    slot.style.height='';slot.append(make(artist));mounted.set(id,artist);painted.set(id,keyFor(artist));resize.observe(slot);return true;
  }
  /* 列表本身变了以后，用「移动」把这次变化交代清楚：活下来的卡片从旧位置滑到新位置，
     刚出现的在它该在的地方淡入、轻轻上浮一下。只有视口附近的才动——看不见的动画只是白花钱。 */
  function animateChanges(container,list,before){
    if(calm())return;
    const top=container.getBoundingClientRect().top,limit=window.innerHeight||0;
    for(const slot of list){
      // 屏幕外的占位不测量；动画只遍历已挂载的卡片和最前面的少量新占位。
      if(!mounted.has(slot.dataset.uid)&&Number(slot.dataset.index)>7)continue;
      if(typeof slot.animate!=='function')continue;
      const rect=slot.getBoundingClientRect(),y=rect.top-top,from=before.get(slot.dataset.uid);
      if(from!==undefined){
        const delta=from-y;
        if(Math.abs(delta)<1||rect.top>limit+600||rect.top+rect.height<-600)continue;
        slot.animate([{transform:`translateY(${delta}px)`},{transform:'none'}],{duration:260,easing:'cubic-bezier(.22,.61,.36,1)'});
      }else if(rect.top<limit+200&&rect.top>-400){
        slot.animate([{opacity:0,transform:'translateY(16px) scale(.985)'},{opacity:1,transform:'none'}],{duration:300,easing:'cubic-bezier(.22,.61,.36,1)'});
      }
    }
  }
  function positions(container){
    const before=new Map();if(calm())return before;
    const top=container.getBoundingClientRect().top;
    for(const uid of mounted.keys())before.set(uid,slots.get(uid).getBoundingClientRect().top-top);
    return before;
  }
  function render(container,rows,makeCard,key,patchCard){
    const next=rows.map(a=>a.uid),same=uids.length>0&&next.length===uids.length&&next.every((uid,i)=>uid===uids[i]);
    current=rows;make=makeCard;patch=patchCard;if(key)keyOf=key;
    if(same){
      /* 还是同一批画师、同样顺序，只是内容可能变了（刚保存了某一位）。
         只把指纹真的变了的那些重画；重建上千个占位会连整棵布局树一起丢掉，
         那正是保存后卡顿的来源。 */
      const changed=[...mounted.keys()].filter(uid=>painted.get(uid)!==keyFor(current[Number(slots.get(uid).dataset.index)]));
      if(!changed.length)return;
      const before=positions(container);
      for(const uid of changed)paint(slots.get(uid));
      // 编辑态收起也会改变高度；只测量可见卡片，沿用列表增减时的位移动画。
      animateChanges(container,[...mounted.keys()].map(uid=>slots.get(uid)),before);
      return;
    }
    /* 记下每张「已经挂上了卡片」的占位现在在哪儿，一会儿要让它们滑到新位置去。
       空占位不记：那只是一块灰底，跳不跳没人看得出来。 */
    const before=positions(container);
    const wanted=new Set(next);
    for(const [uid,slot] of slots)if(!wanted.has(uid)){if(mounted.has(uid)){ArtistImages.dispose('card:'+uid);mounted.delete(uid);}observer?.unobserve(slot);resize?.unobserve(slot);slot.remove();slots.delete(uid);painted.delete(uid);near.delete(uid);}
    uids=next;
    resize??=new ResizeObserver(entries=>{for(const entry of entries){const id=entry.target.dataset.uid;const h=entry.target.getBoundingClientRect().height;if(h>0)heights.set(id,h);}});
    observer??=new IntersectionObserver(entries=>{for(const entry of entries){const slot=entry.target,id=slot.dataset.uid;if(slots.get(id)!==slot)continue;
      if(entry.isIntersecting){near.add(id);mountSlot(slot);}else{near.delete(id);releaseSlot(slot);}
    }},{rootMargin:'650px'});
    const width=window.innerWidth;
    const requested=typeof getComputedStyle==='function'?parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-size'))||190:190;
    const estimate=Math.round(requested+(width<=460?130:112));
    const list=next.map((uid,i)=>{const kept=slots.get(uid);
      /* 还在的画师接着用原来那块占位：卡片不用卸了再挂，图片也不用重取一遍。
         这条是删除/筛选之后不再整屏闪一下的关键。 */
      if(kept){if(Number(kept.dataset.index)!==i)kept.dataset.index=i;return kept;}
      const slot=document.createElement('div');slot.className='artist-slot';slot.dataset.uid=uid;slot.dataset.index=i;slot.style.height=(heights.get(uid)||estimate)+'px';slots.set(uid,slot);slot.addEventListener?.('focusout',()=>queueMicrotask(()=>{if(!near.has(uid))releaseSlot(slot);}));observer.observe(slot);return slot;});
    // 已有节点留在原处；新增只插入，真正换序时才移动，避免整棵列表拆装。
    list.forEach((slot,i)=>{if(container.children[i]!==slot)container.insertBefore(slot,container.children[i]||null);});
    /* 复用的占位里，内容真的变了的补画一下。 */
    for(const slot of list)if(mounted.has(slot.dataset.uid))paint(slot);
    animateChanges(container,list,before);
  }
  function releaseSlot(slot){
    const id=slot.dataset.uid;
    if(!slots.has(id)||!mounted.has(id)||pinned.has(id)||slot.contains?.(document.activeElement))return;
    const h=slot.getBoundingClientRect().height;heights.set(id,h);resize.unobserve(slot);ArtistImages.dispose('card:'+id);slot.replaceChildren();slot.style.height=h+'px';mounted.delete(id);painted.delete(id);
  }
  // 密度或窗口尺寸变化后，修正离屏占位；不重建可见卡片和编辑表单。
  function remeasure(){
    const samples=[];for(const id of mounted.keys()){const slot=slots.get(id);if(!pinned.has(id)&&!slot.querySelector?.('.is-editing'))samples.push(slot.getBoundingClientRect().height);}
    if(!samples.length)return;const average=Math.round(samples.reduce((n,h)=>n+h,0)/samples.length);
    for(const [id,slot] of slots)if(!mounted.has(id)){heights.set(id,average);slot.style.height=average+'px';}
  }
  window.ArtistGallery={
    render,clear,remeasure,
    mount(uid){return mountSlot(slots.get(uid));},
    pin(uid,value){if(value)pinned.add(uid);else pinned.delete(uid);},
    /* 卡片内容在别处就地更新完了（比如编辑态里那一排作品格），跟画廊说一声「这张已经是最新的」，
       免得下一次 render 又照着旧指纹把它整张重画一遍，把正在用的候选列表一起冲掉。 */
    markPainted(uid){const slot=slots.get(uid);if(!slot)return;const artist=current[Number(slot.dataset.index)];if(artist)painted.set(uid,keyFor(artist));},
    visible(){return [...mounted.values()];},
  };
})();
