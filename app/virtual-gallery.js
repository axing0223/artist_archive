(() => {
  let observer,resize,current=[],make=null;const mounted=new Map(),heights=new Map(),pinned=new Set(),slots=new Map();
  function clear(){observer?.disconnect();resize?.disconnect();for(const id of mounted.keys())ArtistImages.dispose('card:'+id);mounted.clear();slots.clear();}
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
  function render(container,rows,makeCard){
    clear();
    current=rows;make=makeCard;
    resize=new ResizeObserver(entries=>{for(const entry of entries){const id=entry.target.dataset.uid;const h=entry.target.getBoundingClientRect().height;if(h>0)heights.set(id,h);}});
    observer=new IntersectionObserver(entries=>{for(const entry of entries){const slot=entry.target,id=slot.dataset.uid;
      if(entry.isIntersecting)mountSlot(slot);
      else if(mounted.has(id)&&!pinned.has(id)){const h=slot.getBoundingClientRect().height;heights.set(id,h);resize.unobserve(slot);ArtistImages.dispose('card:'+id);slot.replaceChildren();slot.style.height=h+'px';mounted.delete(id);}
    }},{rootMargin:'1000px'});
    const estimate=window.innerWidth<760?650:310;
    const list=rows.map((a,i)=>{const slot=document.createElement('div');slot.className='artist-slot';slot.dataset.uid=a.uid;slot.dataset.index=i;slot.style.height=(heights.get(a.uid)||estimate)+'px';return slot;});
    container.replaceChildren(...list);list.forEach(slot=>{slots.set(slot.dataset.uid,slot);observer.observe(slot);});
  }
  window.ArtistGallery={render,clear,mount(uid){return mountSlot(slots.get(uid));},pin(uid,value){if(value)pinned.add(uid);else pinned.delete(uid);},visible(){return [...mounted.values()];}};
})();
