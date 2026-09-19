import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
/* 生图参数存在 localStorage 里，Node 侧给一个最小的替身。 */
const store=new Map();
globalThis.localStorage={getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value))};
globalThis.ArtistNovelAI=require('./app/novelai.js');
const gen=require('./app/image-gen.js');
const reset=()=>store.clear();

test('生图参数：坏值一律回落到默认，不把垃圾发去 NovelAI',()=>{
  reset();
  const bad=gen.sanitize({model:'胡说',size:'4096x4096',width:99999,height:'abc',steps:0,scale:-1,sampler:'x',seed:1.5,ucPreset:'y',width2:1});
  assert.equal(bad.model,'nai-diffusion-5-full');
  assert.equal(bad.size,'832x1216','默认竖图 832 × 1216');
  assert.equal(bad.width,null,'超范围的宽不留下来，交给档位决定');
  assert.equal(bad.height,null);
  assert.equal(bad.steps,28);
  assert.equal(bad.scale,5);
  assert.equal(bad.sampler,'k_euler_ancestral');
  assert.equal(bad.seed,null,'种子必须是整数，留空即随机');
  assert.equal(bad.ucPreset,'heavy');
  assert.equal(typeof bad.prompt1,'string');assert.equal(typeof bad.prompt2,'string');
});
test('生图参数：用户自己填的宽高、模型、采样器要原样保留',()=>{
  reset();
  const settings=gen.save({model:'nai-diffusion-4-5-full',size:'1024x1024',width:960,height:1280,steps:35,scale:6.5,sampler:'k_dpmpp_2m',seed:12345,ucPreset:'light',negativePrompt:'bad hands',prompt1:'a {tag}',prompt2:'b {tag}'});
  assert.deepEqual(gen.load(),settings,'存进去再读出来要一模一样');
  assert.equal(gen.load().height,1280);
  assert.equal(gen.load().negativePrompt,'bad hands');
});
test('token 单独存一个键，绝不和生图参数混在一起',()=>{
  reset();
  gen.save({prompt1:'{tag}',steps:30});gen.saveToken('pst-abcdefghijklmnop');
  assert.equal(gen.loadToken(),'pst-abcdefghijklmnop');
  const raw=store.get(gen.KEY);
  assert.equal(raw.includes('pst-'),false,'生图参数里不能出现 token');
  assert.equal(gen.loadToken.call(null)&&store.get(gen.TOKEN_KEY),'pst-abcdefghijklmnop');
  gen.saveToken('   ');
  assert.equal(gen.loadToken(),'','清空 token 要能真的清掉');
});
test('提示词模板按序号取，{tag} 换成画师 tag',()=>{
  reset();
  const settings=gen.sanitize({prompt1:'one {tag} !',prompt2:'two {tag} !'});
  assert.equal(gen.promptFor(settings,1,{name:'modare'}),'one modare !');
  assert.equal(gen.promptFor(settings,2,{name:'modare'}),'two modare !');
  assert.equal(gen.promptFor(settings,3,{name:'modare'}),'one modare !','只有 1、2 两个固定格，多出来的序号按模板 1 走');
  assert.equal(gen.promptFor(settings,1,{}),'one  !','画师没有名字时不报错');
  assert.equal(gen.bodyFor(settings,1,{name:'modare'}).input,'one modare !'+require('./app/novelai.js').QUALITY_TAGS.v5);
  assert.equal(gen.bodyFor(settings,1,{name:'modare'}).parameters.width,832);
});
test('没有 token 时不发请求，直接说清楚去哪儿填',async()=>{
  reset();
  await assert.rejects(()=>gen.generate({name:'modare'},1,{bridge:{connected:true,canGenerate:true,generate:async()=>{throw Error('不该走到这里');}}}),/token/);
});
test('扩展版本不够时不发请求，提示重新加载扩展',async()=>{
  reset();gen.saveToken('pst-abcdefghijklmnop');
  await assert.rejects(()=>gen.generate({name:'modare'},1,{bridge:{connected:true,canGenerate:false,generate:async()=>{throw Error('不该走到这里');}}}),/重新加载扩展/);
});
test('模板是空的就不发请求，免得白花 Anlas',async()=>{
  reset();gen.saveToken('pst-abcdefghijklmnop');
  await assert.rejects(()=>gen.generate({name:'modare'},1,{settings:gen.sanitize({prompt1:'   '}),bridge:{connected:true,canGenerate:true,generate:async()=>{throw Error('不该走到这里');}}}),/模板是空的/);
});
test('超出总像素上限的尺寸在本地就拦住，不白跑一趟 NovelAI',async()=>{
  reset();gen.saveToken('pst-abcdefghijklmnop');
  let sent=0;
  /* 假扩展返回一坨不是 zip 的数据：只要它被调用过，就说明请求真的发出去了。 */
  const bridge={connected:true,canGenerate:true,generate:async()=>{sent++;return new Blob([Uint8Array.from([1,2,3])],{type:'application/zip'});}};
  await assert.rejects(()=>gen.generate({name:'modare'},1,{bridge,settings:gen.sanitize({width:2048,height:2048})}),/上限/);
  assert.equal(sent,0,'超预算的尺寸不该真的发出去');
  await assert.rejects(()=>gen.generate({name:'modare'},1,{bridge,settings:gen.sanitize({width:1088,height:1920})}),/不是有效的压缩包/);
  assert.equal(sent,1,'壁纸档 1088 × 1920 在预算内，应该放行');
});
test('生成：请求体带模型与尺寸，返回的 zip 解出图片 Blob',async()=>{
  reset();gen.saveToken('pst-abcdefghijklmnop');gen.save({model:'nai-diffusion-5-full',size:'832x1216',steps:30,seed:7});
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,9,9,9]);
  let seen=null;
  const bridge={connected:true,canGenerate:true,async generate(body,token){
    seen={body,token};
    const nameBytes=new TextEncoder().encode('image.png'),local=new Uint8Array(30+nameBytes.length+png.length),lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(8,0,true);lv.setUint32(18,png.length,true);lv.setUint32(22,png.length,true);lv.setUint16(26,nameBytes.length,true);
    local.set(nameBytes,30);local.set(png,30+nameBytes.length);
    const cd=new Uint8Array(46+nameBytes.length),cv=new DataView(cd.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(10,0,true);cv.setUint32(20,png.length,true);cv.setUint32(24,png.length,true);cv.setUint16(28,nameBytes.length,true);
    cd.set(nameBytes,46);
    const eocd=new Uint8Array(22),ev=new DataView(eocd.buffer);
    ev.setUint32(0,0x06054b50,true);ev.setUint16(8,1,true);ev.setUint16(10,1,true);ev.setUint32(12,cd.length,true);ev.setUint32(16,local.length,true);
    const zip=new Uint8Array(local.length+cd.length+eocd.length);zip.set(local,0);zip.set(cd,local.length);zip.set(eocd,local.length+cd.length);
    return new Blob([zip],{type:'application/zip'});
  }};
  const {blob,prompt}=await gen.generate({name:'modare'},1,{bridge});
  assert.equal(seen.token,'pst-abcdefghijklmnop','token 要带给扩展');
  const body=JSON.parse(seen.body);
  assert.equal(body.model,'nai-diffusion-5-full');
  assert.equal(body.parameters.width,832);assert.equal(body.parameters.height,1216);
  assert.equal(body.parameters.steps,30);assert.equal(body.parameters.seed,7);
  assert.equal(body.input.startsWith(prompt),true);
  assert.match(prompt,/modare/,'{tag} 要换成画师 tag');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),png);
  assert.equal(blob.type,'image/png');
});
