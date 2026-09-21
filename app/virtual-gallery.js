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
    /* 卡片高度会变（进出编辑态就是典型）：先按住旧高度，再动画到新高度。
       下面的卡片顺着文档流被一起推开，而不是整块瞬间跳上去。 */
    const before=mounted.has(uid)?slot.getBoundingClientRect().height:0;
    const previous=slot.children[0];
    /* 整块换内容时（浏览态 ↔ 编辑态）给旧内容留一份静态副本渐隐，新内容同时渐显：
       直接换掉是「啪」地一下，看不出是同一张卡在变。副本必须在 dispose 之前克隆，
       否则图片绑定已经释放。patch 成功（就地微调）不走这条路——那种变化本来就很轻。 */
    const replaced=!patch?.(previous,artist);
    const ghost=replaced&&previous&&!calm()&&typeof previous.cloneNode==='function'&&typeof slot.animate==='function'?previous.cloneNode(true):null;
    if(replaced){ArtistImages.dispose('card:'+uid);slot.replaceChildren(make(artist));}
    mounted.set(uid,artist);painted.set(uid,key);
    const fresh=slot.children[0];
    if(ghost&&fresh){
      ghost.classList.add('card-ghost');slot.append(ghost);
      const fade=ghost.animate([{opacity:1},{opacity:0}],{duration:200,easing:'ease-out',fill:'forwards'});
      const drop=()=>ghost.remove();fade.onfinish=drop;fade.oncancel=drop;
      fresh.animate([{opacity:0},{opacity:1}],{duration:200,easing:'ease-out'});
    }
    if(before>0&&!calm()&&typeof slot.animate==='function'){
      const after=slot.getBoundingClientRect().height;
      if(Math.abs(after-before)>1){
        slot.style.height=before+'px';
        const grow=slot.animate([{height:before+'px'},{height:after+'px'}],{duration:280,easing:'cubic-bezier(.22,.61,.36,1)'});
        const settle=()=>{if(slot.style.height)slot.style.height='';};
        grow.onfinish=settle;grow.oncancel=settle;
      }
    }
    return true;
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
  /* 一张卡片里所有随视图变高度的格子：预览图、空格、生图格，连同它们当前的高度。
     另外记下预览整块的位置和宽度——两套视图之间它是从卡片左边挪到右列的。 */
  function previewGeometry(slot){
    const works=slot.querySelector('.works'),box=works?.getBoundingClientRect(),rect=slot.getBoundingClientRect();
    return {height:rect.height,bottom:rect.bottom,left:box?box.left:null,width:box?box.width:null,thumbs:[...slot.querySelectorAll('.thumb,.work-empty,.work-generate')].map(node=>({node,height:node.getBoundingClientRect().height}))};
  }
  const LAYOUT_MS=320,TEXT_MS=160,TEXT_STAGGER_MS=45;
  let layoutAnimations=[],anchorGeneration=0;
  const layoutSlots=new Set();
  /* 换布局（舒适 ↔ 紧凑）时把版面走成一段动画，走完再让文字按顺序淡入。分两段是有意的：
     版面（预览的位置、宽度、每个格子的高度）先动完，文字才一层层出现；
     两边同时动的话，谁也看不清到底是哪里在变。
     宽度只作用在预览整块上，不逐个格子补间——格子是 1fr，早就变成新宽度了，
     要是再让每个格子从旧宽度补间过去，动画一开始五张图会各自溢出自己的格子、互相压住，
     看着就是「闪一下」。整块收放时格子跟着一起变，图只是等比缩放，不会错位。
     这里不写成 CSS transition：--card-size 是用户自己拖的那条滑杆，
     给它加过渡会让拖动变得不跟手，只有切换视图这一下才该有动画。 */
  function animateLayoutChange(mutate){
    if(typeof mutate!=='function')return;
    if(calm()){mutate();remeasure();return;}
    /* 连点两下时先收掉上一轮的动画：它们和新动画打在同一批元素上，
       而且各自的收尾回调会把新动画刚设好的抬层属性抹掉。 */
    for(const animation of layoutAnimations)animation.cancel?.();
    layoutAnimations=[];
    layoutSlots.clear();
    /* 这一段会一次性改动整份文档的高度，浏览器的滚动锚定会同时插手：它和下面的 keepAnchor
       叠在一起反而会多走一段（实测残留 12px）。所以这段时间把它关掉、由 keepAnchor 独家负责，
       动画走完再放开。连点两下时用代次号认领，别把新一轮刚关掉的又放开。 */
    const generation=++anchorGeneration;
    if(document.documentElement?.style)document.documentElement.style.overflowAnchor='none';
    /* 切换前先记一个锚点：视口里最靠上的那张卡。
       上面的卡片在收矮，如果不管，用户正看着的那张卡会被拽着往上跑——实测滚到中间切换时，
       视口里那张卡在 230ms 里往上滑了 126px，看着就是「抖一下」；浏览器的滚动锚定只兜住一部分。
       停在顶部时上方没有内容，这套补正自然什么也不做。 */
    let anchorUid=null,anchorTop=0;
    for(const uid of uids){const slot=slots.get(uid);if(!slot||!mounted.has(uid))continue;const rect=slot.getBoundingClientRect();if(rect.bottom<=0)continue;anchorUid=uid;anchorTop=rect.top;break;}
    const before=new Map();
    for(const [uid,slot] of slots)if(mounted.has(uid))before.set(uid,previewGeometry(slot));
    const gallery=slots.values().next().value?.parentElement;
    const beforeGap=gallery?getComputedStyle(gallery).rowGap:null;
    const bottomDistance=Math.max(0,(document.documentElement?.scrollHeight||0)-(window.innerHeight||0)-(window.scrollY||0));
    const wasScrolled=(window.scrollY||0)>0;
    gallery?.classList.add('is-changing-density');
    mutate();
    // 离屏占位要立刻按新布局修正，否则它们还留着旧高度，滚到那里会跳一下。
    remeasure();
    // 先统一测量终态，再安装动画，避免前一张卡片的动画影响后一张测量。
    const after=new Map();
    for(const [uid,slot] of slots)if(before.has(uid))after.set(uid,previewGeometry(slot));
    const afterGap=gallery?getComputedStyle(gallery).rowGap:null;
    // 已在底部时始终维持底边，不能先固定顶部卡片、等文档变短后再被迫切换到底边。
    const finalMax=Math.max(0,(document.documentElement?.scrollHeight||0)-(window.innerHeight||0));
    const finalAnchor=anchorUid===null?null:slots.get(anchorUid)?.getBoundingClientRect();
    const pinBottom=wasScrolled&&(bottomDistance<=1||(finalAnchor&&(window.scrollY||0)+finalAnchor.top-anchorTop>finalMax+1));
    if(beforeGap!==afterGap&&typeof gallery?.animate==='function'){
      layoutAnimations.push(gallery.animate([{rowGap:beforeGap},{rowGap:afterGap}],{duration:LAYOUT_MS,easing:'cubic-bezier(.22,.61,.36,1)'}));
    }
    /* 终态能容纳原锚点时保持它；否则从一开始就按底边定位。
       不能等收缩到一半才从顶部锚点切到底边，那会让卡片先向上、再反向向下。 */
    let anchorMisses=0;
    const keepAnchor=()=>{
      if(typeof window.scrollBy!=='function')return;
      if(pinBottom){
        const max=Math.max(0,(document.documentElement?.scrollHeight||0)-(window.innerHeight||0));
        window.scrollBy(0,max-(window.scrollY||0));return;
      }
      if(anchorUid===null)return;
      const slot=slots.get(anchorUid);if(!slot)return;
      const diff=slot.getBoundingClientRect().top-anchorTop;
      if(Math.abs(diff)<=0.5)return;
      /* 锚点的目标位置已经落在能滚到的范围之外——页面缩短之后滚在底部附近的那次切换就是这样。
         这时候修正根本落不下去：向"有效"的方向滚一下、下一帧又被夹回来，逐帧往复，
         屏幕上就是来回抽搐。够不到就直接放手，让浏览器夹到新的位置。 */
      const max=Math.max(0,(document.documentElement?.scrollHeight||0)-(window.innerHeight||0));
      const want=(window.scrollY||0)+diff;
      if(want<0||want>max+1){anchorUid=null;return;}
      const wasY=window.scrollY||0;
      window.scrollBy(0,diff);
      if(Math.abs((window.scrollY||0)-wasY)<0.5&&++anchorMisses>=2)anchorUid=null;
    };
    /* 收尾按时钟、不按帧数：无头浏览器里 rAF 的频率和 60Hz 无关，按帧数算会提前收工
       （实测 300ms 时锚定就已经放开了，内容又被拽走几像素）。没有时钟的环境（单元测试的替身）
       退回帧数，那里的 rAF 是同步的，给多了也只是空转。 */
    const clock=typeof performance!=='undefined'&&typeof performance.now==='function'?()=>performance.now():null;
    const deadline=clock?clock()+LAYOUT_MS+120:null;
    let pinFrames=clock?1000:40;
    const pin=()=>{
      if(generation!==anchorGeneration)return;
      const done=pinFrames--<=0||(deadline!==null&&clock()>=deadline);
      if(done){
        gallery?.classList.remove('is-changing-density');
        if(document.documentElement?.style)document.documentElement.style.overflowAnchor='';
        const completed=[...layoutSlots];layoutSlots.clear();
        for(const uid of completed)if(!near.has(uid))releaseSlot(slots.get(uid));
        return;
      }
      keepAnchor();requestAnimationFrame(pin);
    };
    for(const [uid,slot] of slots){
      const was=before.get(uid);if(!was)continue;
      const card=slot.firstElementChild;
      // 编辑器是全宽表单，两套视图里长得一样，不参与这套动画。
      if(card?.classList.contains('is-editing'))continue;
      /* 完全在视口上方的占位不参与动画：它们看不见，动画纯属白做；更要紧的是它们的伸缩会
         把视口里的内容整体拽走，而修正滚动只能在下一帧生效（rAF 跑在动画更新之前），
         于是每帧都残留一点、看起来就是持续抖动。让它们在切换那一帧直接到位，
         锚点补偿就能一次补干净，动画期间视口上方不再有任何变化。 */
      if(was.bottom<=0)continue;
      layoutSlots.add(uid);
      /* 身份信息从「整行」变成「一列」，几何是跳过去的；它的淡入交给下面那段按序文字动画，
         不在这里先淡一次——否则两段会叠在一起，看不出是「先版面、后文字」。 */
      /* 预览整块在两套视图之间左右换位，这里要的是实打实的位移，不是淡入：
         网格已经把它瞬移到新位置了，用 transform 把它拉回旧位置再滑过去。
         滑动期间它会从身份信息上面压过去，所以临时抬到上层——
         position/zIndex 不参与布局，动画结束就撤掉，不会留下副作用。 */
      const now=after.get(uid),works=card?.querySelector('.works');
      // 卡片在文档流中的高度也从旧值连续收放，不能先采用新布局的高度再由图片撑回去。
      if(typeof slot.animate==='function'&&Math.abs(was.height-now.height)>1){
        layoutAnimations.push(slot.animate([{height:was.height+'px'},{height:now.height+'px'}],{duration:LAYOUT_MS,easing:'cubic-bezier(.22,.61,.36,1)'}));
      }
      if(works&&was.left!==null&&now.left!==null&&typeof works.animate==='function'){
        const dx=was.left-now.left,widthChanged=Math.abs(was.width-now.width)>1;
        if(Math.abs(dx)>1||widthChanged){
          works.style.position='relative';works.style.zIndex='1';works.style.willChange='transform,width';
          const from={transform:'translateX('+dx+'px)'},to={transform:'none'};
          if(widthChanged){from.width=was.width+'px';to.width=now.width+'px';}
          const settle=()=>{works.style.position='';works.style.zIndex='';works.style.willChange='';};
          const slide=works.animate([from,to],{duration:LAYOUT_MS,easing:'cubic-bezier(.22,.61,.36,1)'});
          slide.onfinish=settle;slide.oncancel=settle;
          layoutAnimations.push(slide);
        }
      }
      /* 格子只补间高度：宽度已经由整块带着走了。 */
      for(const [index,preview] of now.thumbs.entries()){
        const from=was.thumbs[index];
        if(!from||typeof preview.node.animate!=='function'||Math.abs(from.height-preview.height)<1)continue;
        layoutAnimations.push(preview.node.animate([{height:from.height+'px'},{height:preview.height+'px'}],{duration:LAYOUT_MS,easing:'cubic-bezier(.22,.61,.36,1)'}));
      }
      /* 文字排在版面动画之后，按顺序一行一行淡入：序号与数量（含破窗的分类标签）→ 名字 → 笔名 → 备注。
         顺序写死成设计顺序，不按文档顺序（文档里名字排在数量前面），也不按几何位置算——
         动画刚起步时元素的几何还夹着上一套视图的中间值，算出来的顺序会飘（实测把分类标签
         排到了序号和数量中间）。
         判断「这一行要不要淡入」只看 display，不看当前高度：备注的 ::details-content 是从
         0 高度过渡展开的，切换那一瞬间量到的高度还是 0，用高度过滤会把整段备注漏掉。 */
      const rows=[
        [...card.querySelectorAll('.serial,.artist-site-count,.artist-meta')],
        [card.querySelector('h2')],
        [card.querySelector('.alias')],
        [card.querySelector('.artist-notes')],
      ];
      rows.forEach((nodes,step)=>nodes.filter(node=>node&&getComputedStyle(node).display!=='none').forEach(node=>{
        if(typeof node.animate!=='function')return;
        layoutAnimations.push(node.animate([{opacity:0},{opacity:1}],{duration:TEXT_MS,delay:LAYOUT_MS+step*TEXT_STAGGER_MS,easing:'ease-out',fill:'backwards'}));
      }));
    }
    // 所有旧尺寸已由动画接住后才补偿滚动，避免中间的短页面让锚点提前失效。
    keepAnchor();
    requestAnimationFrame(pin);
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
    /* 离屏占位的高度按「当前这套视图」的滑杆估：紧凑视图有自己的 --card-size-compact，
       拿舒适视图的 --card-size 去估会让文档高度虚高一倍，滚动条与跳转目标都会跟着错。 */
    const heightVar=document.documentElement?.dataset?.density==='compact'?'--card-size-compact':'--card-size';
    const requested=typeof getComputedStyle==='function'?parseFloat(getComputedStyle(document.documentElement).getPropertyValue(heightVar))||190:190;
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
    if(!slot)return;
    const id=slot.dataset.uid;
    if(!slots.has(id)||!mounted.has(id)||pinned.has(id)||layoutSlots.has(id)||slot.contains?.(document.activeElement))return;
    const h=slot.getBoundingClientRect().height;heights.set(id,h);resize.unobserve(slot);ArtistImages.dispose('card:'+id);slot.replaceChildren();slot.style.height=h+'px';mounted.delete(id);painted.delete(id);
  }
  // 密度或窗口尺寸变化后，修正离屏占位；不重建可见卡片和编辑表单。
  function remeasure(){
    const samples=[];for(const id of mounted.keys()){const slot=slots.get(id);if(!pinned.has(id)&&!slot.querySelector?.('.is-editing'))samples.push(slot.getBoundingClientRect().height);}
    if(!samples.length)return;const average=Math.round(samples.reduce((n,h)=>n+h,0)/samples.length);
    for(const [id,slot] of slots)if(!mounted.has(id)){heights.set(id,average);slot.style.height=average+'px';}
  }
  window.ArtistGallery={
    render,clear,remeasure,animateLayoutChange,
    mount(uid){return mountSlot(slots.get(uid));},
    pin(uid,value){if(value)pinned.add(uid);else pinned.delete(uid);},
    /* 卡片内容在别处就地更新完了（比如编辑态里那一排作品格），跟画廊说一声「这张已经是最新的」，
       免得下一次 render 又照着旧指纹把它整张重画一遍，把正在用的候选列表一起冲掉。 */
    markPainted(uid){const slot=slots.get(uid);if(!slot)return;const artist=current[Number(slot.dataset.index)];if(artist)painted.set(uid,keyFor(artist));},
    visible(){return [...mounted.values()];},
  };
})();
