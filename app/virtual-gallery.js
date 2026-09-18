(() => {
  let observer,resize;const mounted=new Map(),heights=new Map(),pinned=new Set();
  function clear(){observer?.disconnect();resize?.disconnect();for(const id of mounted.keys())ArtistImages.dispose('card:'+id);mounted.clear();}
  function render(container,rows,makeCard){
    clear();
    resize=new ResizeObserver(entries=>{for(const entry of entries){const id=entry.target.dataset.uid;const h=entry.target.getBoundingClientRect().height;if(h>0)heights.set(id,h);}});
    observer=new IntersectionObserver(entries=>{for(const entry of entries){const slot=entry.target,id=slot.dataset.uid;
      if(entry.isIntersecting&&!mounted.has(id)){const a=rows[Number(slot.dataset.index)];slot.style.height='';slot.append(makeCard(a));mounted.set(id,a);resize.observe(slot);}
      else if(!entry.isIntersecting&&mounted.has(id)&&!pinned.has(id)){const h=slot.getBoundingClientRect().height;heights.set(id,h);resize.unobserve(slot);ArtistImages.dispose('card:'+id);slot.replaceChildren();slot.style.height=h+'px';mounted.delete(id);}
    }},{rootMargin:'1000px'});
    const estimate=window.innerWidth<760?650:310;
    const slots=rows.map((a,i)=>{const slot=document.createElement('div');slot.className='artist-slot';slot.dataset.uid=a.uid;slot.dataset.index=i;slot.style.height=(heights.get(a.uid)||estimate)+'px';return slot;});
    container.replaceChildren(...slots);slots.forEach(slot=>observer.observe(slot));
  }
  window.ArtistGallery={render,clear,pin(uid,value){if(value)pinned.add(uid);else pinned.delete(uid);},visible(){return [...mounted.values()];}};
})();
