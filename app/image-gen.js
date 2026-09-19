(function(root){
  'use strict';
  /* 生图参数只存在本机浏览器里：token 单独一个键，其余参数一个键。
     绝不写进「画师库.json」，导出的备份也就不会带上 token。 */
  const KEY='artist-library.image-gen',TOKEN_KEY='artist-library.novelai-token',MIN_VERSION='0.4.1';
  const DEFAULT_PROMPTS={
    prompt1:'{tag}, 1girl, solo, upper body, looking at viewer, simple background, white background',
    prompt2:'{tag}, 1girl, solo, full body, standing, outdoors, day, scenery',
  };
  const DEFAULTS={model:'nai-diffusion-5-full',size:'832x1216',width:null,height:null,steps:28,scale:5,cfgRescale:0,sampler:'k_euler_ancestral',seed:null,ucPreset:'heavy',negativePrompt:'',transparentBg:false,useAnlas:false,...DEFAULT_PROMPTS};
  /* 两个都能答订阅信息，站点客户端会先问 image 再问 api。 */
  const ACCOUNT_ENDPOINTS=['https://image.novelai.net/user/subscription','https://api.novelai.net/user/subscription'];
  const ACCOUNT_TTL=60000;
  let accountCache=null;
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
      cfgRescale:num(input.cfgRescale,0,1)??DEFAULTS.cfgRescale,
      sampler:pick(root.ArtistNovelAI.SAMPLERS,input.sampler,DEFAULTS.sampler),
      seed:int(input.seed,0,4294967295),
      ucPreset:pick(root.ArtistNovelAI.UC_PRESETS,input.ucPreset,DEFAULTS.ucPreset),
      negativePrompt:text(input.negativePrompt,4000),
      transparentBg:input.transparentBg===true,
      useAnlas:input.useAnlas===true,
      prompt1:typeof input.prompt1==='string'?input.prompt1.slice(0,4000):DEFAULT_PROMPTS.prompt1,
      prompt2:typeof input.prompt2==='string'?input.prompt2.slice(0,4000):DEFAULT_PROMPTS.prompt2,
    };
  }
  function load(){try{return sanitize(JSON.parse(root.localStorage.getItem(KEY)||'{}'));}catch{return sanitize({});}}
  const save=settings=>{const clean=sanitize(settings);try{root.localStorage.setItem(KEY,JSON.stringify(clean));}catch{}return clean;};
  const loadToken=()=>{try{return String(root.localStorage.getItem(TOKEN_KEY)||'').trim();}catch{return '';}};
  /* 清空时写成空串而不是删键：存储不可用时也不会抛错。 */
  const saveToken=value=>{const token=String(value??'').trim();try{root.localStorage.setItem(TOKEN_KEY,token);}catch{}accountCache=null;return token;};
  const promptFor=(settings,seq,artist)=>root.ArtistNovelAI.fillTemplate(seq===2?settings.prompt2:settings.prompt1,{tag:String(artist?.name||'')});
  const bodyFor=(settings,seq,artist)=>root.ArtistNovelAI.buildBody(settings,promptFor(settings,seq,artist));

  /* 站点把 Opus 额度给成一个会随时间回复的百分比，网页界面上显示的张数是按
     17.3 × 百分比 估出来的（照抄站点客户端的算式），所以只能当估算值看。 */
  const estimate=percent=>percent==null?null:Math.round(17.3*percent);
  function normalizeAccount(payload){
    const raw=payload&&typeof payload==='object'?payload:{},steps=raw.trainingStepsLeft&&typeof raw.trainingStepsLeft==='object'?raw.trainingStepsLeft:{};
    const value=key=>{const n=Number(key);return Number.isFinite(n)?n:0;};
    const usage=raw.usage&&typeof raw.usage==='object'?raw.usage:null;
    const percentRaw=usage?Number(usage.percent):NaN;
    const negative=usage?.isNegative===true;
    const percent=Number.isFinite(percentRaw)?(negative?0:Math.max(0,percentRaw)):null;
    const seconds=usage?Number(usage.timeUntilNextPercent):NaN;
    const refillPercent=Number.isFinite(seconds)&&seconds>0?Math.round(86400/seconds*10)/10:null;
    return {
      tier:raw.tier??raw.subscriptionTier??null,
      subscriptionAnlas:value(steps.fixedTrainingStepsLeft),paidAnlas:value(steps.purchasedTrainingSteps),
      anlas:value(steps.fixedTrainingStepsLeft)+value(steps.purchasedTrainingSteps),
      opusPercent:percent,opusImages:estimate(percent),
      refillPercent,refillImages:estimate(refillPercent),negative,
    };
  }
  /* 查额度。默认 60 秒内用缓存，避免每张卡片渲染都去打接口。 */
  async function account({bridge=root.ArtistExtension,token=loadToken(),force=false,signal}={}){
    if(!token)throw Error('还没有填写 NovelAI token：请打开「生图参数」。');
    if(!force&&accountCache&&Date.now()-accountCache.time<ACCOUNT_TTL)return accountCache.value;
    if(!bridge)throw Error('没有检测到「画师库 · 图片助手」扩展，无法查询点数。');
    if(!bridge.connected)await bridge.check();
    if(!bridge.canAccount)throw Error('图片助手需要 '+MIN_VERSION+' 或更高版本才能查点数：请到浏览器的扩展页重新加载扩展。');
    let lastError=null;
    for(const url of ACCOUNT_ENDPOINTS){
      try{const value={...normalizeAccount(await bridge.subscription(url,token,signal)),at:Date.now()};accountCache={value,time:Date.now()};return value;}
      catch(error){if(error?.name==='AbortError')throw error;lastError=error;}
    }
    throw lastError||Error('读取订阅信息失败。');
  }
  const cachedAccount=()=>accountCache?accountCache.value:null;
  const clearAccount=()=>{accountCache=null;};
  const needsPoints=(width,height,steps)=>width*height>root.ArtistNovelAI.FREE_PIXELS||steps>root.ArtistNovelAI.FREE_STEPS;
  /* 拿扩展当代理去调 NovelAI：请求由扩展的后台发出，不受页面所在 file:// 的跨域限制。 */
  async function generate(artist,seq,{bridge=root.ArtistExtension,signal,settings=load(),token=loadToken()}={}){
    if(!token)throw Error('还没有填写 NovelAI token：请打开「生图参数」。');
    if(!settings)settings=load();
    const prompt=promptFor(settings,seq,artist);
    if(!prompt.trim())throw Error('提示词模板是空的，请先在「生图参数」里填写。');
    if(settings.transparentBg&&!root.ArtistNovelAI.isV5(settings.model))throw Error('透明背景（Native Alpha）只有 V5 模型支持，请换模型或关掉这个开关。');
    if(!bridge)throw Error('没有检测到「画师库 · 图片助手」扩展，无法调用 NovelAI。');
    if(!bridge.connected)await bridge.check();
    if(!bridge.canGenerate||!bridge.canAccount)throw Error('图片助手需要 '+MIN_VERSION+' 或更高版本才能生图：请到浏览器的扩展页重新加载扩展。');
    const body=bodyFor(settings,seq,artist),parameters=body.parameters;
    let width=parameters.width,height=parameters.height,steps=parameters.steps;
    const free=settings.useAnlas!==true;
    /* 「不用点数」时先确认免费额度还查得到且还有剩：查不到就不发，免得在不知情的情况下花掉 Anlas。 */
    let info=null,accountError=null;
    try{info=await account({bridge,token,signal});}catch(error){if(error?.name==='AbortError')throw error;accountError=error;}
    if(free){
      if(accountError)throw Error('读不到 Opus 剩余额度，按「不使用点数」的规则先不生成（'+accountError.message+'）。也可以打开「使用点数」，自行承担可能的消耗。');
      if(!(info.opusPercent>0))throw Error('Opus 免费额度已经用完（剩余 '+info.opusPercent+'%）。等额度回复，或打开「使用点数」用 Anlas 生成。');
      const fit=root.ArtistNovelAI.fitPixels(width,height,root.ArtistNovelAI.FREE_PIXELS);
      width=parameters.width=fit.width;height=parameters.height=fit.height;
      steps=parameters.steps=Math.min(steps,root.ArtistNovelAI.FREE_STEPS);
    }else if(info&&info.anlas<=0&&needsPoints(width,height,steps)){
      throw Error('没有可用点数（Anlas 0），当前 '+width+' × '+height+' / '+steps+' 步超出了免费范围。把尺寸或步数调小，或去 NovelAI 充值点数。');
    }
    /* 单边上限之外的约束是总像素：1536 × 2048。超了先在本地拦住，别白跑一趟还浪费一次请求。 */
    if(width*height>root.ArtistNovelAI.MAX_PIXELS)throw Error(`宽 × 高 超过 NovelAI 的上限（1536 × 2048），当前 ${width} × ${height}，请把其中一边调小。`);
    /* 请求体在这里就序列化成字符串：扩展只是搬运工，不碰参数的含义。 */
    const zip=await bridge.generate(JSON.stringify(body),token,signal);
    const blob=await root.ArtistNovelAI.firstImageFromZip(new Uint8Array(await zip.arrayBuffer()));
    return {blob,prompt,settings,free,width,height,steps,account:info,accountError};
  }
  root.ArtistImageGen={load,save,loadToken,saveToken,sanitize,promptFor,bodyFor,generate,account,cachedAccount,clearAccount,normalizeAccount,needsPoints,DEFAULTS,DEFAULT_PROMPTS,ACCOUNT_ENDPOINTS,KEY,TOKEN_KEY,MIN_VERSION};
  if(typeof module!=='undefined')module.exports=root.ArtistImageGen;
})(globalThis);
