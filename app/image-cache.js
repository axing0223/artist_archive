(function(root){
  class ByteCache{
    constructor(maxBytes=32*1024*1024,maxEntries=64){this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.items=new Map();this.bytes=0;}
    get(key){const v=this.items.get(key);if(v){this.items.delete(key);this.items.set(key,v);}return v;}
    set(key,value){if(this.items.has(key)){this.bytes-=this.items.get(key).size;this.items.delete(key);}if(value.size>this.maxBytes)return;this.items.set(key,value);this.bytes+=value.size;while(this.bytes>this.maxBytes||this.items.size>this.maxEntries){const first=this.items.keys().next().value;this.bytes-=this.items.get(first).size;this.items.delete(first);}}
    delete(key){const value=this.items.get(key);if(value){this.bytes-=value.size;this.items.delete(key);}}
    clear(){this.items.clear();this.bytes=0;}
  }
  class Queue{
    constructor(limit=3){this.limit=limit;this.active=0;this.waiting=[];}
    run(fn,signal){return new Promise((resolve,reject)=>{if(signal?.aborted){reject(new DOMException('已取消','AbortError'));return;}const job={fn,signal,resolve,reject};const cancel=()=>{const i=this.waiting.indexOf(job);if(i>=0){this.waiting.splice(i,1);reject(new DOMException('已取消','AbortError'));}};job.cleanup=()=>signal?.removeEventListener('abort',cancel);signal?.addEventListener('abort',cancel,{once:true});this.waiting.push(job);this.pump();});}
    pump(){while(this.active<this.limit&&this.waiting.length){const j=this.waiting.shift();j.cleanup();if(j.signal?.aborted){j.reject(new DOMException('已取消','AbortError'));continue;}this.active++;Promise.resolve().then(j.fn).then(j.resolve,j.reject).finally(()=>{this.active--;this.pump();});}}
  }
  root.ImageResources={ByteCache,Queue};if(typeof module!=='undefined')module.exports=root.ImageResources;
})(globalThis);
