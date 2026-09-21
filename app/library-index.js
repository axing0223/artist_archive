/* 查询与统计只依赖资料快照，不触碰文件系统或 DOM。每个新快照只建一次索引。 */
(() => {
 'use strict';
 const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
 function create(){
  let source=null,length=0,entries=[],stats=null;const sorted=new Map();
  function prepare(artists){
   if(source===artists&&length===artists.length)return;
   source=artists;length=artists.length;sorted.clear();
   const counts=new Map([['全部',length],['待判断',0]]);let works=0,tests=0;
   entries=artists.map((artist,index)=>{
    const category=artist.category||'待判断';counts.set(category,(counts.get(category)||0)+1);
    works+=artist.works.length;for(const work of artist.works)if(work.kind==='test')tests++;
    const search=[artist.name,artist.alias,...(artist.aliases||[]),...artist.tags,artist.description,artist.note,artist.uid,String(artist.order??index+1)].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
    return {artist,index,search};
   });
   stats={total:length,images:works,tests,works:works-tests,counts};sorted.set('order',entries);
  }
  return {
   summary(artists){prepare(artists);return stats;},
   select(artists,{category='全部',tags=new Set(),scores=new Set(),special=new Set(),query='',sort='order',desc=false,slots=5}={}){
    prepare(artists);const mode=['name','score','works'].includes(sort)?sort:'order';
    /* 方向进缓存键：升序与降序各排一份，来回切换不用反复排。 */
    const key=mode+(desc?'~desc':'');
    if(!sorted.has(key)){
     const list=[...entries].sort((a,b)=>{
      /* order 就是快照原本的顺序：delta 恒为 0，自然落到下面的 index 比较。 */
      const delta=mode==='name'?collator.compare(a.artist.name,b.artist.name):mode==='score'?(b.artist.score||0)-(a.artist.score||0):mode==='works'?b.artist.works.length-a.artist.works.length:0;
      return delta||a.index-b.index;
     });
     /* 同分（同评分 / 同张数）时仍按序号稳定排列，所以整份反过来就是纯倒序。 */
     if(desc)list.reverse();
     sorted.set(key,list);
    }
    const words=query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean),activeTags=[...tags];
    /* 特殊筛选：按「缺什么」找，而不是按有什么找。
       站点作品少于 50——「没读到」在数据里是 null 而不是缺字段，Number(null)===0，
       写成数字判断会把没读到的当成 0 张；不知道不等于少。
       例图空缺——格子里只要有一个空着就算，**测试风格图也算占一格**：卡片固定就是 5 格，
       开「固定测试风格图」只是把最右两格留给测试风格 1、2，格子总数不变。
       所以判据是「works 条数 < 格数」，两种设置下都是 5。 */
    const fewWorks=special.has('low-works'),noWorks=special.has('no-works');
    const knownCount=value=>value!==null&&value!==undefined&&value!=='';
    const hasFewWorks=a=>knownCount(a.counts?.total)&&Number(a.counts.total)<50;
    const hasEmptySlot=a=>(a.works||[]).length<slots;
    return sorted.get(key).filter(({artist:a,search})=>(category==='全部'||(category==='待判断'?!a.category:a.category===category))&&activeTags.every(t=>a.tags.includes(t))&&(!scores.size||scores.has(a.score||0))&&(!fewWorks||hasFewWorks(a))&&(!noWorks||hasEmptySlot(a))&&words.every(word=>search.includes(word))).map(entry=>entry.artist);
   },
   clear(){source=null;length=0;entries=[];stats=null;sorted.clear();}
  };
 }
 window.ArtistLibraryIndex={create};
})();
