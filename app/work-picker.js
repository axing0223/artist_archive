(function(root){
  'use strict';
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const btn=(text,fn,cls='action')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
  const LIMIT=20;
  function mount(container,{uid,tag,exclude,onPreview=()=>{},limit=LIMIT}={}){
    const group='picker:'+uid;
    const status=el('small','picker-status','正在读取作品…'),grid=el('div','candidate-previews'),tools=el('div','candidate-tools'),counter=el('small','');
    container.append(status,grid,tools);
    const picked=new Set();
    let works=[],page=1,exhausted=false,disposed=false;
    const skipped=()=>exclude&&exclude.size?` · 库中已有的 ${exclude.size} 张不会再列出`:'';
    const updateCount=()=>{counter.textContent=`已选 ${picked.size} / ${works.length} 张${exhausted?'':' · 还有更多'}${skipped()}`;};
    const render=()=>{
      grid.replaceChildren(...works.map(w=>{
        const label=el('label','pick'),box=el('input');box.type='checkbox';box.checked=picked.has(w.id);
        box.onchange=()=>{if(box.checked)picked.add(w.id);else picked.delete(w.id);updateCount();};
        const img=el('img');img.alt=tag+' #'+w.id;img.width=90;
        ArtistImages.bind(img,uid,w,group,'thumb',error=>{label.title=error.message;});
        label.append(box,img,btn('#'+w.id,()=>onPreview(w),'pick-id'));
        return label;
      }));
      updateCount();
    };
    const loadMore=async()=>{
      const batch=await ArtistLookup.posts(tag,{limit,page});
      if(disposed)return works.length;
      if(batch.length<limit)exhausted=true;
      const fresh=batch.filter(w=>!exclude||!exclude.has(w.id));
      works=works.concat(fresh);fresh.forEach(w=>picked.add(w.id));page++;
      render();return works.length;
    };
    const more=btn('加载更多',async()=>{
      more.disabled=true;more.textContent='正在读取…';
      try{status.textContent=`已读取 ${await loadMore()} 张作品`;}
      catch(error){status.textContent='读取失败：'+error.message;}
      finally{more.disabled=false;more.textContent='加载更多';more.hidden=exhausted;}
    });
    tools.append(counter,btn('全选',()=>{works.forEach(w=>picked.add(w.id));render();}),btn('全不选',()=>{picked.clear();render();}),more);
    const ready=loadMore().then(total=>{status.textContent=total?`找到 ${total} 张作品，点图片编号可放大查看。`:'没有可添加的新作品。';})
      .catch(error=>{status.textContent='作品读取失败：'+error.message;});
    return {
      ready,
      selected(){return works.filter(w=>picked.has(w.id));},
      dispose(){disposed=true;ArtistImages.dispose(group);container.replaceChildren();},
    };
  }
  root.WorkPicker={mount};
})(globalThis);
