import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
/* 手搓一个够用的 IndexedDB：对象仓库 + put/get/delete，异步触发 onsuccess。
   真浏览器里的升级流程也要走到：第一次 open 会先 onupgradeneeded 再 onsuccess。 */
class FakeRequest{
  constructor(run){this.result=undefined;this.error=null;Promise.resolve().then(()=>{try{this.result=run();this.onsuccess?.();}catch(error){this.error=error;this.onerror?.();}});}
}
class FakeStore{
  constructor(map){this.map=map;}
  put(value,key){return new FakeRequest(()=>{this.map.set(key,value);return key;});}
  get(key){return new FakeRequest(()=>this.map.get(key));}
  delete(key){return new FakeRequest(()=>{this.map.delete(key);return true;});}
}
class FakeDB{
  constructor(){this.stores=new Map();}
  createObjectStore(name){if(this.stores.has(name))throw Error('已存在');this.stores.set(name,new Map());}
  transaction(name){const map=this.stores.get(name);if(!map)throw Error('没有这个仓库：'+name);const store=new FakeStore(map);return {objectStore:()=>store};}
  close(){this.closed=true;}
}
const fakeIndexedDB=()=>{
  const db=new FakeDB();
  return {db,open(){const request={result:db,onupgradeneeded:null,onsuccess:null,onerror:null};
    Promise.resolve().then(()=>{if(!db.stores.has('handles'))db.createObjectStore('handles');request.onupgradeneeded?.();request.onsuccess?.();});
    return request;}};
};
const memory=()=>{delete require.cache[require.resolve('./app/folder-memory.js')];return require('./app/folder-memory.js');};

test('记住/取回/忘记：句柄存进 IndexedDB 再原样拿回来',async()=>{
  const memoryModule=memory(),fake=fakeIndexedDB();
  memoryModule.useFactory(fake);
  assert.equal(await memoryModule.load(),null,'第一次打开时没有记忆');
  const handle={name:'数据',kind:'directory'};
  assert.equal(await memoryModule.save(handle),true);
  assert.equal(await memoryModule.load(),handle,'取回来的就是同一个句柄对象');
  assert.equal(fake.db.stores.get('handles').get('dataFolder'),handle,'确实落在约定的仓库与键上');
  assert.equal(await memoryModule.forget(),true);
  assert.equal(await memoryModule.load(),null);
});
test('存不了就静默失败：没有 IndexedDB、或事务直接报错时都不能抛出去',async()=>{
  const memoryModule=memory();
  memoryModule.useFactory(null);   // 恢复默认：Node 里没有 indexedDB，等价于环境不支持
  assert.equal(await memoryModule.load(),null);
  assert.equal(await memoryModule.save({name:'数据'}),false,'存不了要如实返回 false，好让界面提示');
  assert.equal(await memoryModule.forget(),false);
  const broken={open(){throw Error('IndexedDB 被禁用');}};
  memoryModule.useFactory(broken);
  assert.equal(await memoryModule.load(),null);
  assert.equal(await memoryModule.save({name:'数据'}),false);
  const failing={open(){const request={result:null,onupgradeneeded:null,onsuccess:null,onerror:null};Promise.resolve().then(()=>{request.error=Error('打开失败');request.onerror?.();});return request;}};
  memoryModule.useFactory(failing);
  assert.equal(await memoryModule.load(),null);
  memoryModule.useFactory(fakeIndexedDB());
  assert.equal(await memoryModule.save(null),false,'没句柄就别写');
});
test('重复打开不会因为「仓库已存在」而失败，用完关掉连接',async()=>{
  const memoryModule=memory(),fake=fakeIndexedDB();
  memoryModule.useFactory(fake);
  assert.equal(await memoryModule.save({name:'甲'}),true);
  assert.equal(fake.db.stores.has('handles'),true,'第一次打开时把对象仓库建好');
  fake.db.closed=false;
  /* 第二次、第三次打开时仓库已经在了，createObjectStore 会抛错，模块必须自己咽下去 */
  assert.deepEqual(await memoryModule.load(),{name:'甲'});
  assert.equal(fake.db.closed,true,'用完要关掉连接');
  assert.equal(await memoryModule.save({name:'乙'}),true);
  assert.deepEqual(await memoryModule.load(),{name:'乙'},'改过的句柄要能覆盖旧的');
});
