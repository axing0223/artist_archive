import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ai=require('./app/novelai.js');

test('模型与尺寸列表覆盖需求：V5 Full 默认、竖图/宽图/方图都在',()=>{
  assert.equal(ai.MODELS[0].value,'nai-diffusion-5-full','默认模型是 V5 Full');
  assert.equal(ai.MODELS.every(m=>/^nai-diffusion-(3|4|5)/.test(m.value)),true,'模型值必须是站点认识的那几个');
  const sizes=Object.fromEntries(ai.SIZES.map(s=>[s.value,[s.width,s.height]]));
  assert.deepEqual(sizes['832x1216'],[832,1216],'竖图');
  assert.deepEqual(sizes['1216x832'],[1216,832],'宽图');
  assert.deepEqual(sizes['1024x1024'],[1024,1024],'方图');
  assert.equal(ai.SIZES.every(s=>s.width*s.height<=ai.MAX_PIXELS),true,'每个档位都要在总像素上限之内');
  assert.deepEqual(Object.fromEntries(ai.UC_PRESETS.map(p=>[p.value,p.label])).heavy,'Heavy');
  assert.deepEqual(ai.UC_PRESETS.map(p=>p.value),['heavy','none'],'只给文字有可靠来源的预设');
  assert.equal(ai.SAMPLERS.some(s=>s.value==='k_euler_ancestral'),true);
  assert.equal(ai.familyOf('nai-diffusion-5-full'),'v5');
  assert.equal(ai.familyOf('nai-diffusion-4-5-full'),'v45');
  assert.equal(ai.familyOf('nai-diffusion-4-full'),'v4');
  assert.equal(ai.familyOf('nai-diffusion-3'),'v3');
  for(const family of ['v3','v4','v45','v5'])assert.equal(typeof ai.UC_HEAVY[family],'string','每个家族都要有自己的 UC 文字：'+family);
});

test('V5 请求体：params_version 4、ucPresetId 是字符串、没有 qualityToggle、必带 v4_prompt',()=>{
  const body=ai.buildBody({model:'nai-diffusion-5-full',size:'832x1216',ucPreset:'heavy',steps:28,scale:5,seed:7},'1girl, {tag}');
  assert.equal(body.action,'generate');
  assert.equal(body.model,'nai-diffusion-5-full');
  assert.equal(body.parameters.params_version,4);
  assert.equal(body.parameters.ucPresetId,'heavy','V5 的 ucPresetId 是字符串');
  assert.equal(body.parameters.qualityPresetId,'standard');
  assert.equal('qualityToggle' in body.parameters,false,'V5 的请求体里没有 qualityToggle');
  assert.equal('sm' in body.parameters,false);
  assert.equal('skip_cfg_above_sigma' in body.parameters,false);
  assert.equal(body.parameters.noise_schedule,'karras','V4/V5 要用 karras');
  assert.equal(body.parameters.width,832);assert.equal(body.parameters.height,1216);
  assert.equal(body.parameters.seed,7);
  assert.equal(body.parameters.image_format,'png');
  assert.equal('straight_alpha' in body.parameters,false,'没开透明背景就不发 alpha 相关字段（见 transparent BG 那条）');
  assert.equal(body.parameters.v4_prompt.caption.base_caption,body.input,'v4_prompt 的 base_caption 要和 input 一致');
  assert.equal(body.parameters.v4_negative_prompt.caption.base_caption,body.parameters.negative_prompt,'v4_negative_prompt 要和 negative_prompt 一致');
  assert.deepEqual(body.parameters.v4_prompt.caption.char_captions,[]);
  assert.equal(body.input.includes(ai.QUALITY_TAGS.v5),true,'质量标签要自己拼进 prompt');
  assert.equal(body.parameters.negative_prompt.startsWith(ai.UC_HEAVY.v5),true,'UC 预设文本要拼进 negative_prompt');
});
test('V3 / V4 / V4.5 各用自己家族的质量标签与 UC 文字，不是全都按 V5 发',()=>{
  const v3=ai.buildBody({model:'nai-diffusion-3',size:'1024x1024',ucPreset:'heavy'},'x');
  assert.equal(v3.input,'x'+ai.QUALITY_TAGS.v3);
  assert.equal(v3.parameters.negative_prompt,ai.UC_HEAVY.v3,'V3 的 UC 文字和 V5 不是同一段');
  assert.equal(v3.parameters.params_version,3);
  const v4=ai.buildBody({model:'nai-diffusion-4-full'},'x');
  assert.equal(v4.input,'x'+ai.QUALITY_TAGS.v4);
  assert.equal(v4.parameters.negative_prompt,ai.UC_HEAVY.v4);
  assert.equal(v4.parameters.v4_prompt.caption.base_caption,v4.input,'V4 要带 v4_prompt');
  assert.equal(v4.parameters.params_version,3,'V4 不是 V5，params_version 仍是 3');
  const v45=ai.buildBody({model:'nai-diffusion-4-5-full'},'x');
  assert.equal(v45.input,'x'+ai.QUALITY_TAGS.v45);
  assert.equal(v45.parameters.negative_prompt,ai.UC_HEAVY.v45);
  const none=ai.buildBody({model:'nai-diffusion-5-full',ucPreset:'none'},'x');
  assert.equal(none.parameters.negative_prompt,'','选「无」就不拼 UC 文字');
  assert.equal(none.parameters.ucPresetId,'none');
});
test('V4.5 与 V5 的 heavy UC 文字确实不同（V4.5 结尾多一个逗号）',()=>{
  assert.equal(ai.UC_HEAVY.v45,ai.UC_HEAVY.v5+',');
  assert.notEqual(ai.UC_HEAVY.v4,ai.UC_HEAVY.v5);
  assert.notEqual(ai.UC_HEAVY.v3,ai.UC_HEAVY.v5);
});

test('V3 请求体不带 v4_prompt，也不带 V5 专有字段',()=>{
  const body=ai.buildBody({model:'nai-diffusion-3',size:'1024x1024',ucPreset:'heavy'},'x');
  assert.equal(body.parameters.params_version,3);
  assert.equal('v4_prompt' in body.parameters,false);
  assert.equal('ucPresetId' in body.parameters,false);
  assert.equal('qualityPresetId' in body.parameters,false);
  assert.equal(body.parameters.noise_schedule,'native');
  assert.equal(body.parameters.qualityToggle,false,'V3 由我们自己拼质量标签，不让服务器再拼一遍');
  assert.equal(body.input,'x'+ai.QUALITY_TAGS.v3,'V3 拼自己那一份质量标签');
});

test('非法设置一律回落到安全默认，不把坏值发出去',()=>{
  const body=ai.buildBody({model:'胡说',size:'不存在',ucPreset:'x',sampler:'y',steps:-3,scale:-1,width:9999,height:1},'p');
  assert.equal(body.model,'nai-diffusion-5-full');
  assert.equal(body.parameters.ucPresetId,'heavy');
  assert.equal(body.parameters.sampler,'k_euler_ancestral');
  assert.equal(body.parameters.steps,28);
  assert.equal(body.parameters.scale,5);
  assert.equal(Number.isSafeInteger(body.parameters.seed),true);
  assert.ok(body.parameters.seed>=0);
  assert.equal(body.parameters.width,2048,'超宽要被钳到单边上限 2048');
  assert.equal(body.parameters.height,64,'过小要被钳到下限 64');
});

test('Prompt Guidance Rescale 是 cfg_rescale，默认 0，越界回落',()=>{
  assert.equal(ai.buildBody({},'x').parameters.cfg_rescale,0,'默认 0');
  assert.equal(ai.buildBody({cfgRescale:0.35},'x').parameters.cfg_rescale,0.35);
  assert.equal(ai.buildBody({cfgRescale:0},'x').parameters.cfg_rescale,0);
  assert.equal(ai.buildBody({cfgRescale:9},'x').parameters.cfg_rescale,0,'超过 1 的坏值不照发');
  assert.equal(ai.buildBody({cfgRescale:'abc'},'x').parameters.cfg_rescale,0);
});
test('transparent BG：V5 按站点客户端发三个字段，其他模型一个都不发',()=>{
  const v5=ai.buildBody({model:'nai-diffusion-5-full',transparentBg:true},'x').parameters;
  assert.equal(v5.tag_hint_transparent_background,true);
  assert.equal(v5.straight_alpha,true);
  assert.equal(v5.image_format,'png');
  const off=ai.buildBody({model:'nai-diffusion-5-full'},'x').parameters;
  assert.equal('tag_hint_transparent_background' in off,false,'没开就不发这个提示');
  assert.equal('straight_alpha' in off,false);
  assert.equal(off.image_format,'png','V5 一律要 PNG');
  for(const model of ['nai-diffusion-4-5-full','nai-diffusion-4-full','nai-diffusion-3']){
    const other=ai.buildBody({model,transparentBg:true},'x').parameters;
    assert.equal('tag_hint_transparent_background' in other,false,model+' 不支持原生透明，不该发这个字段');
    assert.equal('straight_alpha' in other,false,model);
  }
});
test('免费额度：fitPixels 等比缩进 1M 像素，永远不超预算也不低于 64',()=>{
  assert.deepEqual(ai.fitPixels(832,1216,ai.FREE_PIXELS),{width:832,height:1216},'默认竖图本来就在免费范围内，原样保留');
  assert.deepEqual(ai.fitPixels(1024,1024,ai.FREE_PIXELS),{width:1024,height:1024},'正好 1M 也算免费');
  const wide=ai.fitPixels(1024,1536,ai.FREE_PIXELS);
  assert.ok(wide.width*wide.height<=ai.FREE_PIXELS,'大竖图要被压回预算内');
  assert.deepEqual(wide,{width:832,height:1216},'比例基本不变');
  const wallpaper=ai.fitPixels(1088,1920,ai.FREE_PIXELS);
  assert.ok(wallpaper.width*wallpaper.height<=ai.FREE_PIXELS);
  assert.ok(Math.abs(wallpaper.width/wallpaper.height-1088/1920)<0.05,'壁纸比例也要留住');
  for(const [w,h] of [[2048,2048],[64,2048],[1536,2048]]){
    const fit=ai.fitPixels(w,h,ai.FREE_PIXELS);
    assert.ok(fit.width*fit.height<=ai.FREE_PIXELS,`${w}×${h} 压不进预算`);
    assert.equal(fit.width%64,0);assert.equal(fit.height%64,0);
    assert.ok(fit.width>=64&&fit.height>=64);
  }
  assert.deepEqual(ai.fitPixels(10,10,ai.FREE_PIXELS),{width:64,height:64},'过小的尺寸抬到下限');
  assert.equal(ai.FREE_STEPS,28,'站点把 28 步以内算作免费');
});
test('宽高对齐到 64 的倍数',()=>{
  assert.equal(ai.nearest64(100),128);
  assert.equal(ai.nearest64(1),64);
  assert.equal(ai.nearest64(1024),1024);
  const body=ai.buildBody({width:830,height:1215},'p');
  assert.equal(body.parameters.width,832);
  assert.equal(body.parameters.height,1216);
});

test('prompt 模板替换 {tag}，未知变量原样保留',()=>{
  assert.equal(ai.fillTemplate('artist:{tag}, 1girl','{tag}'.length?{tag:'modare'}:{}),'artist:modare, 1girl');
  assert.equal(ai.fillTemplate('{tag} {tag}',{tag:'a'}),'a a');
  assert.equal(ai.fillTemplate('{tag} {未知}',{tag:'a'}),'a {未知}','拼错的变量留着，便于发现');
  assert.equal(ai.fillTemplate('',{tag:'a'}),'');
  assert.equal(ai.fillTemplate('{tag}'),'{tag}','没有变量表时不替换也不报错');
});

/* 手搓一个单条目 zip，用来验证解包；压缩方式可选 0=存储 8=deflate */
async function makeZip(name,data,method=0){
  const nameBytes=new TextEncoder().encode(name);
  let payload=data;
  if(method===8){
    const stream=new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    payload=new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const local=new Uint8Array(30+nameBytes.length+payload.length),lv=new DataView(local.buffer);
  lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(8,method,true);
  lv.setUint32(18,payload.length,true);lv.setUint32(22,data.length,true);
  lv.setUint16(26,nameBytes.length,true);
  local.set(nameBytes,30);local.set(payload,30+nameBytes.length);
  const cd=new Uint8Array(46+nameBytes.length),cv=new DataView(cd.buffer);
  cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);
  cv.setUint16(10,method,true);cv.setUint32(20,payload.length,true);cv.setUint32(24,data.length,true);
  cv.setUint16(28,nameBytes.length,true);cv.setUint32(42,0,true);
  cd.set(nameBytes,46);
  const eocd=new Uint8Array(22),ev=new DataView(eocd.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(8,1,true);ev.setUint16(10,1,true);
  ev.setUint32(12,cd.length,true);ev.setUint32(16,local.length,true);
  const out=new Uint8Array(local.length+cd.length+eocd.length);
  out.set(local,0);out.set(cd,local.length);out.set(eocd,local.length+cd.length);
  return out;
}
const pngBytes=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4,5,6,7,8]);
test('zip 解包：存储与 deflate 两种压缩都要能取出图片',async()=>{
  for(const method of [0,8]){
    const zip=await makeZip('image.png',pngBytes,method);
    const blob=await ai.firstImageFromZip(zip);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),pngBytes,`压缩方式 ${method}`);
    assert.equal(blob.type,'image/png');
  }
});
test('zip 里没有图片时如实报错，不返回坏数据',async()=>{
  const zip=await makeZip('readme.txt',new TextEncoder().encode('hello'),0);
  await assert.rejects(()=>ai.firstImageFromZip(zip),/没有图片/);
  await assert.rejects(()=>ai.firstImageFromZip(Uint8Array.from([1,2,3,4,5])),/不是有效的压缩包/);
});
