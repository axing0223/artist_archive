(function(root){
  'use strict';
  /* 生图参数只存在本机浏览器里：token 单独一个键，其余参数一个键。
     绝不写进「画师库.json」，导出的备份也就不会带上 token。 */
  const KEY='artist-library.image-gen',TOKEN_KEY='artist-library.novelai-token',MIN_VERSION='0.4.0';
  const DEFAULT_PROMPTS={
    prompt1:'{tag}, 1girl, solo, upper body, looking at viewer, simple background, white background',
    prompt2:'{tag}, 1girl, solo, full body, standing, outdoors, day, scenery',
  };
  const DEFAULTS={model:'nai-diffusion-5-full',size:'832x1216',width:null,height:null,steps:28,scale:5,sampler:'k_euler_ancestral',seed:null,ucPreset:'heavy',negativePrompt:'',...DEFAULT_PROMPTS};
  const int=(value,min,max)=>{const n=Number(String(value??'').trim());return Number.isSafeInteger(n)&&n>=min&&n<=max?n:null;};
  const num=(value,min,max)=>{const n=Number(String(value??'').trim());return Number.isFinite(n)&&n>=min&&n<=max?n:null;};
  const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
  /* 表单里可能是空字符串、超范围数字、根本没见过的模型名，一律回落到安全默认。 */
  function sanitize(raw){
    const input=raw&&typeof raw==='object'?raw:{},pick=(list,value,fallback)=>list.some(item=>item.value===value)?value:fallback;
    return {
      model:pick(root.ArtistNovelAI.MODELS,input.model,DEFAULTS.model),
      size:pick(root.ArtistNovelAI.SIZES,input.size,DEFAULTS.size),
      width:int(input.width,64,2048),height:int(input.height,64,2048),
      steps:int(input.steps,1,50)??DEFAULTS.steps,
      scale:num(input.scale,0,20)??DEFAULTS.scale,
      sampler:pick(root.ArtistNovelAI.SAMPLERS,input.sampler,DEFAULTS.sampler),
      seed:int(input.seed,0,4294967295),
      ucPreset:pick(root.ArtistNovelAI.UC_PRESETS,input.ucPreset,DEFAULTS.ucPreset),
      negativePrompt:text(input.negativePrompt,2000),
      prompt1:typeof input.prompt1==='string'?input.prompt1.slice(0,2000):DEFAULT_PROMPTS.prompt1,
      prompt2:typeof input.prompt2==='string'?input.prompt2.slice(0,2000):DEFAULT_PROMPTS.prompt2,
    };
  }
  function load(){try{return sanitize(JSON.parse(root.localStorage.getItem(KEY)||'{}'));}catch{return sanitize({});}}
  const save=settings=>{const clean=sanitize(settings);try{root.localStorage.setItem(KEY,JSON.stringify(clean));}catch{}return clean;};
  const loadToken=()=>{try{return String(root.localStorage.getItem(TOKEN_KEY)||'').trim();}catch{return '';}};
  /* 清空时写成空串而不是删键：存储不可用时也不会抛错。 */
  const saveToken=value=>{try{root.localStorage.setItem(TOKEN_KEY,String(value??'').trim());}catch{}};
  const promptFor=(settings,seq,artist)=>root.ArtistNovelAI.fillTemplate(seq===2?settings.prompt2:settings.prompt1,{tag:String(artist?.name||'')});
  const bodyFor=(settings,seq,artist)=>root.ArtistNovelAI.buildBody(settings,promptFor(settings,seq,artist));
  /* 拿扩展当代理去调 NovelAI：请求由扩展的后台发出，不受页面所在 file:// 的跨域限制。 */
  async function generate(artist,seq,{bridge=root.ArtistExtension,signal,settings=load(),token=loadToken()}={}){
    if(!token)throw Error('还没有填写 NovelAI token：请打开「设置 → 生图参数」。');
    if(!settings)settings=load();
    const prompt=promptFor(settings,seq,artist);
    if(!prompt.trim())throw Error('提示词模板是空的，请先在「设置 → 生图参数」里填写。');
    if(!bridge)throw Error('没有检测到「画师库 · 图片助手」扩展，无法调用 NovelAI。');
    if(!bridge.connected)await bridge.check();
    if(!bridge.canGenerate)throw Error('图片助手需要 '+MIN_VERSION+' 或更高版本才能生图：请到浏览器的扩展页重新加载扩展。');
    const body=bodyFor(settings,seq,artist),{width,height}=body.parameters;
    /* 单边上限之外的约束是总像素：1536 × 2048。超了先在本地拦住，别白跑一趟还浪费一次请求。 */
    if(width*height>root.ArtistNovelAI.MAX_PIXELS)throw Error(`宽 × 高 超过 NovelAI 的上限（1536 × 2048），当前 ${width} × ${height}，请把其中一边调小。`);
    /* 请求体在这里就序列化成字符串：扩展只是搬运工，不碰参数的含义。 */
    const zip=await bridge.generate(JSON.stringify(body),token,signal);
    const blob=await root.ArtistNovelAI.firstImageFromZip(new Uint8Array(await zip.arrayBuffer()));
    return {blob,prompt,settings};
  }
  root.ArtistImageGen={load,save,loadToken,saveToken,sanitize,promptFor,bodyFor,generate,DEFAULTS,DEFAULT_PROMPTS,KEY,TOKEN_KEY,MIN_VERSION};
  if(typeof module!=='undefined')module.exports=root.ArtistImageGen;
})(globalThis);
