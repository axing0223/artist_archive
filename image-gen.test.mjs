import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
/* 生图参数存在 localStorage 里，Node 侧给一个最小的替身。 */
const store=new Map();
globalThis.localStorage={getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value))};
globalThis.ArtistNovelAI=require('./app/novelai.js');
const gen=require('./app/image-gen.js');
const reset=()=>{store.clear();gen.clearAccount();};

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
  const sent=[];
  const bridge=fakeBridge({tier:3,usage:{percent:60},trainingStepsLeft:{fixedTrainingStepsLeft:900}},body=>sent.push(body.parameters));
  /* 开了使用点数：按填的原样发，超过 1536 × 2048 先在本地拦下 */
  await assert.rejects(()=>gen.generate({name:'modare'},1,{bridge,settings:gen.sanitize({width:2048,height:2048,useAnlas:true})}),/上限/);
  assert.equal(sent.length,0,'超预算的尺寸不该真的发出去');
  const wallpaper=gen.sanitize({width:1088,height:1920,useAnlas:true});
  const ok=await gen.generate({name:'modare'},1,{bridge,settings:wallpaper});
  assert.equal(sent.length,1,'壁纸档在预算内，应该放行');
  assert.equal(sent[0].width,1088);assert.equal(sent[0].height,1920);
  assert.equal(ok.width,1088);
  /* 不用点数：先压进免费额度，自然不会超预算，也就轮不到报错 */
  await gen.generate({name:'modare'},1,{bridge,settings:gen.sanitize({width:2048,height:2048,useAnlas:false})});
  assert.ok(sent[1].width*sent[1].height<=1024*1024,'2048 × 2048 会被压进 1M 免费范围');
});
/* 假扩展：给一份订阅信息，生成时回一个装着一张 PNG 的 zip。 */
const pngBytes=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
function zipOf(png=pngBytes){
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
}
const fakeBridge=(account,onBody)=>({connected:true,canGenerate:true,canAccount:true,subscription:async()=>{if(account instanceof Error)throw account;return account;},generate:async body=>{if(onBody)onBody(JSON.parse(body));return zipOf();}});

test('订阅信息换算：Opus 百分比按站点算式 17.3 估算张数，Anlas 分订阅与购买',()=>{
  reset();
  const info=gen.normalizeAccount({tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:250},usage:{percent:42.5,timeUntilNextPercent:8640}});
  assert.equal(info.tier,3);
  assert.equal(info.subscriptionAnlas,1000);assert.equal(info.paidAnlas,250);assert.equal(info.anlas,1250);
  assert.equal(info.opusPercent,42.5);
  assert.equal(info.opusImages,Math.round(17.3*42.5),'张数按 17.3 × 百分比 估算');
  assert.equal(info.refillPercent,10,'每天回复 86400 / 8640 = 10%');
  assert.equal(info.refillImages,Math.round(17.3*10));
  const negative=gen.normalizeAccount({usage:{percent:-5,isNegative:true}});
  assert.equal(negative.opusPercent,0,'负额度按 0 算，不能显示成还有额度');
  const empty=gen.normalizeAccount({});
  assert.equal(empty.anlas,0);assert.equal(empty.opusPercent,null,'没给百分比就说不知道，别编一个 0');
  assert.equal(empty.opusImages,null);
});
test('额度查询：先问 image 域名，失败再问 api 域名，成功后 60 秒内走缓存',async()=>{
  reset();gen.saveToken('pst-abcdefghijklmnop');gen.clearAccount();
  const tried=[];
  const bridge={connected:true,canAccount:true,async subscription(url){tried.push(url);if(url.includes('image.'))throw Error('这个域名不通');return {tier:3,usage:{percent:10},trainingStepsLeft:{fixedTrainingStepsLeft:7}};}};
  const first=await gen.account({bridge});
  assert.deepEqual(tried,['https://image.novelai.net/user/subscription','https://api.novelai.net/user/subscription'],'第一个域名失败要自动退到第二个');
  assert.equal(first.anlas,7);
  await gen.account({bridge});
  assert.equal(tried.length,2,'缓存期内不再打接口');
  await gen.account({bridge,force:true});
  assert.equal(tried.length,4,'force 要真的重查（两个域名各再问一次）');
  gen.clearAccount();
  await assert.rejects(()=>gen.account({bridge:{connected:true,canAccount:true,subscription:async()=>{throw Error('两个都不通');}}}),/两个都不通/);
});
test('额度查询：缺 token 或扩展版本不够时给出可执行的提示，不发请求',async()=>{
  reset();gen.clearAccount();
  await assert.rejects(()=>gen.account({bridge:{connected:true,canAccount:false,subscription:async()=>{throw Error('不该走到这里');}}}),/token/,'没 token 先提示填 token');
  gen.saveToken('pst-abcdefghijklmnop');
  let asked=0;
  await assert.rejects(()=>gen.account({bridge:{connected:true,canAccount:false,subscription:async()=>{asked++;}}}),/0\.4\.1/);
  assert.equal(asked,0,'版本不够就别去问，省得干等超时');
});
test('不用点数：压进步数与 1M 像素，并且要先确认免费额度还有剩',async()=>{
  reset();gen.saveToken('pst-abcdefghijklmnop');gen.clearAccount();
  const sent=[];
  const settings=gen.sanitize({width:1024,height:1536,steps:40,useAnlas:false});
  const result=await gen.generate({name:'modare'},1,{bridge:fakeBridge({tier:3,usage:{percent:50},trainingStepsLeft:{fixedTrainingStepsLeft:100}},body=>sent.push(body.parameters)),settings});
  assert.equal(result.free,true);
  assert.equal(sent[0].steps,28,'步数压到 28');
  assert.ok(sent[0].width*sent[0].height<=1024*1024,'尺寸压进 1M');
  assert.equal(`${result.width} × ${result.height}`,`${sent[0].width} × ${sent[0].height}`,'回给界面的是真正发出去的尺寸');
  assert.equal(new Uint8Array(await result.blob.arrayBuffer()).length,pngBytes.length);
  sent.length=0;gen.clearAccount();
  await assert.rejects(()=>gen.generate({name:'modare'},1,{bridge:fakeBridge({tier:3,usage:{percent:0}},body=>sent.push(body)),settings}),/免费额度已经用完/);
  assert.equal(sent.length,0,'没额度就不发请求');
  gen.clearAccount();
  await assert.rejects(()=>gen.generate({name:'modare'},1,{bridge:fakeBridge(Error('网络不通'),body=>sent.push(body)),settings}),/读不到 Opus 剩余额度/);
  assert.equal(sent.length,0,'额度查不到时默认也不生成');
});
test('使用点数：按填的参数原样发；点数见底又超免费范围时才拦住',async()=>{
  reset();gen.saveToken('pst-abcdefghijklmnop');gen.clearAccount();
  const sent=[];
  const rich=fakeBridge({tier:3,usage:{percent:0},trainingStepsLeft:{fixedTrainingStepsLeft:500}},body=>sent.push(body.parameters));
  const settings=gen.sanitize({width:1024,height:1536,steps:40,useAnlas:true});
  const result=await gen.generate({name:'modare'},1,{bridge:rich,settings});
  assert.equal(result.free,false);
  assert.equal(sent[0].steps,40,'开了使用点数就不再压步数');
  assert.equal(sent[0].width,1024);assert.equal(sent[0].height,1536);
  gen.clearAccount();
  const broke=fakeBridge({tier:3,usage:{percent:0},trainingStepsLeft:{}},body=>sent.push(body.parameters));
  await assert.rejects(()=>gen.generate({name:'modare'},1,{bridge:broke,settings}),/没有可用点数/);
  const cheap=gen.sanitize({size:'832x1216',steps:28,useAnlas:true});
  await gen.generate({name:'modare'},1,{bridge:broke,settings:cheap});
  assert.equal(sent.length,2,'就算点数见底，免费范围内的参数照样能发');
});
test('透明背景只有 V5 支持，别的模型在发请求前就拦下来',async()=>{
  reset();gen.saveToken('pst-abcdefghijklmnop');gen.clearAccount();
  const sent=[];
  const bridge=fakeBridge({tier:3,usage:{percent:50}},body=>sent.push(body.parameters));
  await assert.rejects(()=>gen.generate({name:'modare'},1,{bridge,settings:gen.sanitize({model:'nai-diffusion-4-5-full',transparentBg:true,useAnlas:true})}),/只有 V5/);
  assert.equal(sent.length,0);
  await gen.generate({name:'modare'},1,{bridge,settings:gen.sanitize({model:'nai-diffusion-5-full',transparentBg:true,useAnlas:true})});
  assert.equal(sent.length,1,'V5 开了透明就正常发');
  assert.equal(sent[0].tag_hint_transparent_background,true);
});
test('新参数跟着保存：Prompt Guidance Rescale、透明背景、使用点数',()=>{
  reset();
  const saved=gen.save({cfgRescale:0.4,transparentBg:true,useAnlas:true});
  assert.equal(saved.cfgRescale,0.4);assert.equal(saved.transparentBg,true);assert.equal(saved.useAnlas,true);
  assert.deepEqual(gen.load(),saved);
  const bad=gen.sanitize({cfgRescale:5,transparentBg:'yes',useAnlas:1});
  assert.equal(bad.cfgRescale,0,'超范围的 rescale 回落');
  assert.equal(bad.transparentBg,false,'不是布尔真值就当没开');
  assert.equal(bad.useAnlas,false);
});
test('生成：请求体带模型与尺寸，返回的 zip 解出图片 Blob',async()=>{
  reset();gen.saveToken('pst-abcdefghijklmnop');gen.save({model:'nai-diffusion-5-full',size:'832x1216',steps:30,seed:7,useAnlas:true});
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,9,9,9]);
  let seen=null;
  const bridge={connected:true,canGenerate:true,canAccount:true,subscription:async()=>({tier:3,usage:{percent:80},trainingStepsLeft:{fixedTrainingStepsLeft:500}}),async generate(body,token){
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
