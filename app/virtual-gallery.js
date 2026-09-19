(() => {
  let observer,resize,current=[],make=null,uids=[];const mounted=new Map(),heights=new Map(),pinned=new Set(),slots=new Map();
  /* 系统里关了动效就一个都不放，宁可少点花活也别让人难受。 */
  const calm=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function clear(){observer?.disconnect();resize?.disconnect();for(const id of mounted.keys())ArtistImages.dispose('card:'+id);mounted.clear();slots.clear();uids=[];}
  /* 立刻按卡片真实高度挂载。render() 重建占位用的是上一次量到的高度，
     刚加完作品会比旧高度高，照着旧占位滚动会落到错的位置。 */
  function mountSlot(slot){
    if(!slot)return false;
    const id=slot.dataset.uid;
    if(mounted.has(id))return true;
    const artist=current[Number(slot.dataset.index)];
    if(!artist||!make)return false;
    slot.style.height='';slot.append(make(artist));mounted.set(id,artist);resize.observe(slot);return true;
  }
  /* 列表本身变了以后，用「移动」把这次变化交代清楚：活下来的卡片从旧位置滑到新位置，
     刚出现的在它该在的地方淡入、轻轻上浮一下。只有视口附近的才动——看不见的动画只是白花钱。 */
  function animateChanges(container,list,before){
    if(calm())return;
    const top=container.getBoundingClientRect().top,limit=window.innerHeight||0;
    for(const slot of list){
      if(typeof slot.animate!=='function')continue;
      const rect=slot.getBoundingClientRect(),y=rect.top-top,from=before.get(slot.dataset.uid);
      if(from!==undefined){
        const delta=from-y;
        if(Math.abs(delta)<1||y>limit+600||y+rect.height<-600)continue;
        slot.animate([{transform:`translateY(${delta}px)`},{transform:'none'}],{duration:260,easing:'cubic-bezier(.22,.61,.36,1)'});
      }else if(y<limit+200&&y>-400){
        slot.animate([{opacity:0,transform:'translateY(16px) scale(.985)'},{opacity:1,transform:'none'}],{duration:300,easing:'cubic-bezier(.22,.61,.36,1)'});
      }
    }
  }
  function render(container,rows,makeCard){
    const next=rows.map(a=>a.uid),same=uids.length>0&&next.length===uids.length&&next.every((uid,i)=>uid===uids[i]);
    current=rows;make=makeCard;
    if(same){
      /* 还是同一批画师、同样顺序，只是内容变了（刚保存了某一位）。
         只重画已经挂载的那几张就够；重建上千个占位会连整棵布局树一起丢掉，
         那正是保存后卡顿的来源。 */
      for(const [uid,slot] of slots)if(mounted.has(uid)){
        const artist=current[Number(slot.dataset.index)];
        if(artist){slot.replaceChildren(make(artist));mounted.set(uid,artist);}
      }
      return;
    }
    /* 记下每张「已经挂上了卡片」的占位现在在哪儿，一会儿要让它们滑到新位置去。
       空占位不记：那只是一块灰底，跳不跳没人看得出来。 */
    const top=container.getBoundingClientRect().top,before=new Map();
    for(const [uid,slot] of slots)if(mounted.has(uid))before.set(uid,slot.getBoundingClientRect().top-top);
    observer?.disconnect();resize?.disconnect();
    const wanted=new Set(next);
    for(const [uid,slot] of slots)if(!wanted.has(uid)){if(mounted.has(uid)){ArtistImages.dispose('card:'+uid);mounted.delete(uid);}slots.delete(uid);}
    uids=next;
    resize=new ResizeObserver(entries=>{for(const entry of entries){const id=entry.target.dataset.uid;const h=entry.target.getBoundingClientRect().height;if(h>0)heights.set(id,h);}});
    observer=new IntersectionObserver(entries=>{for(const entry of entries){const slot=entry.target,id=slot.dataset.uid;
      if(entry.isIntersecting)mountSlot(slot);
      else if(mounted.has(id)&&!pinned.has(id)){const h=slot.getBoundingClientRect().height;heights.set(id,h);resize.unobserve(slot);ArtistImages.dispose('card:'+id);slot.replaceChildren();slot.style.height=h+'px';mounted.delete(id);}
    }},{rootMargin:'1000px'});
    const estimate=window.innerWidth<760?650:310;
    const list=next.map((uid,i)=>{const kept=slots.get(uid);
      /* 还在的画师接着用原来那块占位：卡片不用卸了再挂，图片也不用重取一遍。
         这条是删除/筛选之后不再整屏闪一下的关键。 */
      if(kept){kept.dataset.index=i;return kept;}
      const slot=document.createElement('div');slot.className='artist-slot';slot.dataset.uid=uid;slot.dataset.index=i;slot.style.height=(heights.get(uid)||estimate)+'px';slots.set(uid,slot);return slot;});
    container.replaceChildren(...list);list.forEach(slot=>observer.observe(slot));
    animateChanges(container,list,before);
  }
  window.ArtistGallery={render,clear,mount(uid){return mountSlot(slots.get(uid));},pin(uid,value){if(value)pinned.add(uid);else pinned.delete(uid);},visible(){return [...mounted.values()];}};
})();
