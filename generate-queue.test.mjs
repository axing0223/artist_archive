import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),queue=require('./app/generate-queue.js'),gen=require('./app/image-gen.js');
/* sleep 换成记账版：既不真的等，也能看清每条之间到底等了多久。 */
const recorder=()=>{const slept=[];return {slept,sleep:async ms=>{slept.push(ms);}};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('排队：一次只跑一条，顺序与入队顺序一致',async()=>{
  const {sleep}=recorder(),order=[],q=queue.create({gap:()=>1000,sleep});
  let running=0,peak=0;
  const job=name=>async()=>{running++;peak=Math.max(peak,running);order.push('开始'+name);await tick();order.push('结束'+name);running--;};
  q.push({run:job('A')});q.push({run:job('B')});q.push({run:job('C')});
  while(!q.idle)await tick();
  assert.deepEqual(order,['开始A','结束A','开始B','结束B','开始C','结束C'],'必须一条跑完再跑下一条');
  assert.equal(peak,1,'不能并发');
});
test('排队：同一批里第一条不等，之后每条之间都要等一段抖动时间',async()=>{
  const {slept,sleep}=recorder(),q=queue.create({gap:()=>4000,sleep});
  q.push({run:async()=>{}});q.push({run:async()=>{}});q.push({run:async()=>{}});
  while(!q.idle)await tick();
  assert.deepEqual(slept,[4000,4000],'三条需求只该有两次间隔');
});
test('排队：队列空了以后再进来的需求立刻发，不白等一段',async()=>{
  const {slept,sleep}=recorder(),q=queue.create({gap:()=>4000,sleep});
  q.push({run:async()=>{}});
  while(!q.idle)await tick();
  q.push({run:async()=>{}});
  while(!q.idle)await tick();
  assert.deepEqual(slept,[],'两批之间隔了很久的话不该再等');
});
test('排队：一条失败不卡住后面的，失败交给它自己的 onError',async()=>{
  const {sleep}=recorder(),order=[],errors=[],q=queue.create({gap:()=>0,sleep});
  q.push({run:async()=>{order.push('A');throw Error('这条炸了');},onError:e=>errors.push(e.message)});
  q.push({run:async()=>order.push('B')});
  while(!q.idle)await tick();
  assert.deepEqual(order,['A','B'],'后面的照跑');
  assert.deepEqual(errors,['这条炸了']);
  assert.equal(q.pending,0,'失败的那条也要出队');
});
test('排队：没有 onError 也不会把异常抛出去卡住队列',async()=>{
  const {sleep}=recorder(),order=[],q=queue.create({gap:()=>0,sleep});
  q.push({run:async()=>{throw Error('没人接');}});
  q.push({run:async()=>order.push('B')});
  while(!q.idle)await tick();
  assert.deepEqual(order,['B']);
});
test('排队：状态查询（排队中几条、是否空闲、有没有同一格）',async()=>{
  const {sleep}=recorder(),q=queue.create({gap:()=>0,sleep});
  assert.equal(q.idle,true);assert.equal(q.pending,0);assert.equal(q.running,false);
  let release;const gate=new Promise(resolve=>{release=resolve;});
  q.push({uid:'0001-a',seq:1,run:()=>gate});
  await tick();
  assert.equal(q.running,true,'已经在跑了');
  assert.equal(q.pending,0,'正在跑的那条不算在「排队中」');
  assert.equal(q.has(item=>item.uid==='0001-a'&&item.seq===1),false,'已经开始跑的不在待跑名单里');
  q.push({uid:'0002-b',seq:2,run:async()=>{}});
  assert.equal(q.pending,1);
  assert.equal(q.has(item=>item.uid==='0002-b'&&item.seq===2),true,'同一格在排队要查得出来');
  assert.equal(q.has(item=>item.uid==='0002-b'&&item.seq===1),false);
  release();while(!q.idle)await tick();
  assert.equal(q.idle,true);assert.equal(q.has(()=>true),false);
});
test('排队：清空只丢掉还没开始的，正在跑的那条照跑完',async()=>{
  const {sleep}=recorder(),order=[],q=queue.create({gap:()=>0,sleep});
  let release;const gate=new Promise(resolve=>{release=resolve;});
  q.push({run:async()=>{order.push('开始A');await gate;order.push('结束A');}});
  q.push({run:async()=>order.push('B')});
  q.push({run:async()=>order.push('C')});
  await tick();
  assert.equal(q.pending,2,'A 在跑，B、C 在排队');
  assert.equal(q.clear(),2,'清空返回丢掉了两条');
  assert.equal(q.pending,0);
  assert.equal(q.idle,false,'A 还在跑，不算空闲');
  release();while(!q.idle)await tick();
  assert.deepEqual(order,['开始A','结束A'],'被清掉的 B、C 不该再跑');
});
test('间隔就是 5±3 秒，落在 2–8 秒之间',()=>{
  assert.equal(gen.GAP_BASE,5000);assert.equal(gen.GAP_JITTER,3000);
  assert.equal(gen.genGapDelay(()=>0.5),5000,'随机数取中就是 5 秒');
  assert.equal(gen.genGapDelay(()=>0),2000,'最小 2 秒');
  assert.equal(gen.genGapDelay(()=>1),8000,'最大 8 秒');
  for(let i=0;i<200;i++){const ms=gen.genGapDelay();assert.ok(ms>=2000&&ms<=8000,'越界：'+ms);}
});
