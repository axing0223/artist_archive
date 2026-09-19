(function(root){
  'use strict';
  /* 生图排队：一次只跑一条，两条之间留一段随机间隔，避免一口气打过去被站点限流。
     队列只管三件事——顺序、间隔、出错不拖累后面的；每条需求自己带着「怎么跑」。 */
  function create({gap=()=>0,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onChange=()=>{}}={}){
    const items=[];let running=false,ran=0;
    const notify=()=>onChange({running,pending:items.length,ran});
    const done=()=>!running&&!items.length;
    async function pump(){
      if(running)return;
      running=true;notify();
      try{
        while(items.length){
          /* 同一批里的第一条立刻发，之后每一条前都等一段抖动时间。 */
          if(ran>0)await sleep(gap());
          const item=items[0];
          /* 一条失败不能卡住队列：出队、交给它自己的 onError，再接着跑下一条。 */
          try{await item.run();}catch(error){if(item.onError)item.onError(error);}
          items.shift();ran++;notify();
        }
      }finally{running=false;ran=0;notify();}
    }
    return {
      push(item){items.push(item);notify();pump();return items.length;},
      get running(){return running;},
      get pending(){return items.length;},
      get idle(){return done();},
      /* 同一个槽位不要排两次 */
      has:test=>items.some(test),
    };
  }
  root.ArtistGenerateQueue={create};
  if(typeof module!=='undefined')module.exports=root.ArtistGenerateQueue;
})(globalThis);
