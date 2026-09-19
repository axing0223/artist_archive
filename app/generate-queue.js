(function(root){
  'use strict';
  /* 生图排队：一次只跑一条，两条之间留一段随机间隔，避免一口气打过去被站点限流。
     队列只管三件事——顺序、间隔、出错不拖累后面的；每条需求自己带着「怎么跑」。 */
  function create({gap=()=>0,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onChange=()=>{}}={}){
    const items=[];let running=false,ran=0,active=null,waiting=false;
    const notify=()=>onChange({running,pending:items.length,ran,active,waiting});
    const done=()=>!running&&!items.length;
    async function pump(){
      if(running)return;
      running=true;notify();
      try{
        while(items.length){
          /* 先出队再跑：这样「清空排队」只会丢掉还没开始的，正在跑的那条不受影响。 */
          const item=items.shift();
          /* 抖动等待也算「正在跑」：界面这时该显示正在生成，而不是排在第几位。
             同一批里的第一条不等，直接发。 */
          active=item;waiting=ran>0;notify();
          if(waiting){await sleep(gap());waiting=false;notify();}
          /* 一条失败不能卡住队列：交给它自己的 onError，再接着跑下一条。 */
          try{await item.run();}catch(error){if(item.onError)item.onError(error);}
          active=null;ran++;notify();
        }
      }finally{running=false;active=null;waiting=false;ran=0;notify();}
    }
    return {
      push(item){items.push(item);notify();pump();return items.length;},
      /* 清掉还没开始的需求，返回丢掉了多少条；正在跑的那条继续跑完。 */
      clear(){const dropped=items.length;items.length=0;notify();return dropped;},
      get running(){return running;},
      get pending(){return items.length;},
      /* 正在跑的那一条（界面靠它画出「正在生成」），没在跑就是 null。 */
      get current(){return active},
      /* 正在等两条之间的抖动间隔：状态上仍算「正在跑」。 */
      get waiting(){return waiting;},
      /* 还在排队的第几条（1 开始），没排到就返回 0。 */
      positionOf(test){const index=items.findIndex(test);return index<0?0:index+1;},
      get idle(){return done();},
      /* 同一个槽位不要排两次。注意只看得见还没开始的：正在跑的那条已经出队了。 */
      has:test=>items.some(test),
    };
  }
  root.ArtistGenerateQueue={create};
  if(typeof module!=='undefined')module.exports=root.ArtistGenerateQueue;
})(globalThis);
