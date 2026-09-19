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
   select(artists,{category='全部',tags=new Set(),scores=new Set(),query='',sort='order'}={}){
    prepare(artists);const mode=['name','score','works'].includes(sort)?sort:'order';
    if(!sorted.has(mode))sorted.set(mode,[...entries].sort((a,b)=>{
     const delta=mode==='name'?collator.compare(a.artist.name,b.artist.name):mode==='score'?(b.artist.score||0)-(a.artist.score||0):b.artist.works.length-a.artist.works.length;
     return delta||a.index-b.index;
    }));
    const words=query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean),activeTags=[...tags];
    return sorted.get(mode).filter(({artist:a,search})=>(category==='全部'||(category==='待判断'?!a.category:a.category===category))&&activeTags.every(t=>a.tags.includes(t))&&(!scores.size||scores.has(a.score||0))&&words.every(word=>search.includes(word))).map(entry=>entry.artist);
   },
   clear(){source=null;length=0;entries=[];stats=null;sorted.clear();}
  };
 }
 window.ArtistLibraryIndex={create};
})();
