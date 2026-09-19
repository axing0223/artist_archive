(function(root){
  'use strict';
  /* NovelAI 生图。请求体形状取自 @7xrk/novelai-api 的 getGenerateImageParams：
     V5 用 params_version 4、ucPresetId 是字符串、没有 qualityToggle，
     且 V4/V5 必须带 v4_prompt 与 v4_negative_prompt（缺了服务器会 500）。 */
  const ENDPOINT='https://image.novelai.net/ai/generate-image';
  /* 站点对总像素的限制：1536 × 2048。单边 2048 只是硬上限，超预算要在发请求前拦住。 */
  const MAX_PIXELS=1536*2048;
  /* Opus 的免费额度范围：总像素不超过 1M、步数不超过 28。超出这两条就要花 Anlas（点数），
     站点客户端的「Limit to free generation」用的也是这两个数。 */
  const FREE_PIXELS=1024*1024,FREE_STEPS=28;
  const MODELS=[
    {value:'nai-diffusion-5-full',label:'V5 Full'},
    {value:'nai-diffusion-5-curated',label:'V5 Curated'},
    {value:'nai-diffusion-4-5-full',label:'V4.5 Full'},
    {value:'nai-diffusion-4-full',label:'V4 Full'},
    {value:'nai-diffusion-3',label:'V3'},
  ];
  const SIZES=[
    {value:'832x1216',label:'竖图 832 × 1216',width:832,height:1216},
    {value:'1216x832',label:'宽图 1216 × 832',width:1216,height:832},
    {value:'1024x1024',label:'方图 1024 × 1024',width:1024,height:1024},
    {value:'1024x1536',label:'大竖图 1024 × 1536',width:1024,height:1536},
    {value:'1536x1024',label:'大宽图 1536 × 1024',width:1536,height:1024},
    {value:'1472x1472',label:'大方图 1472 × 1472',width:1472,height:1472},
    {value:'1088x1920',label:'壁纸竖图 1088 × 1920',width:1088,height:1920},
    {value:'1920x1088',label:'壁纸宽图 1920 × 1088',width:1920,height:1088},
  ];
  const SAMPLERS=[
    {value:'k_euler_ancestral',label:'Euler Ancestral'},
    {value:'k_euler',label:'Euler'},
    {value:'k_dpmpp_2m',label:'DPM++ 2M'},
    {value:'k_dpmpp_2m_sde',label:'DPM++ 2M SDE'},
    {value:'k_dpmpp_2s_ancestral',label:'DPM++ 2S Ancestral'},
  ];
  /* 只留「Heavy」和「无」：质量标签与 UC 文字都得自己拼进 prompt，
     站点其余预设（light / humanFocus / furryFocus）的文字没有可靠来源，宁可不给也不猜。 */
  const UC_PRESETS=[
    {value:'heavy',label:'Heavy'},
    {value:'none',label:'无'},
  ];
  /* 质量标签按模型家族各不同，文字取自站点客户端（参考实现 @7xrk/novelai-api 的 consts）。
     参考实现的做法是：文字自己拼进 input，qualityToggle 置 false，避免服务器再拼一遍。 */
  const QUALITY_TAGS={
    v5:', very aesthetic, masterpiece, no text',
    v45:', very aesthetic, masterpiece, no text',
    v4:', no text, best quality, very aesthetic, absurdres',
    v3:', best quality, amazing quality, very aesthetic, absurdres',
  };
  const UC_HEAVY={
    v5:'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
    v45:'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page,',
    v4:'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page,',
    v3:'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract],',
  };
  const isV5=model=>/^nai-diffusion-5/.test(String(model));
  const isV4x=model=>isV5(model)||/^nai-diffusion-4/.test(String(model));
  const familyOf=model=>isV5(model)?'v5':/^nai-diffusion-4-5/.test(String(model))?'v45':/^nai-diffusion-4/.test(String(model))?'v4':'v3';
  const nearest64=n=>Math.max(64,Math.round(Number(n)/64)*64);
  /* 单边硬上限是 2048；总像素上限 1536×2048 由调用方在发请求前把关。 */
  const clamp=(n,min,max)=>{const v=Number(n);return Number.isFinite(v)?Math.min(max,Math.max(min,v)):min;};
  const sizeOf=value=>SIZES.find(s=>s.value===value)||SIZES[0];
  /* 把宽高压进免费额度：等比缩到 maxPixels 之内，再向 64 对齐并保证不超预算。
     对齐只会向下取，所以缩完永远不会反弹回预算之上。 */
  function fitPixels(width,height,maxPixels){
    const w=Math.max(64,Number(width)||64),h=Math.max(64,Number(height)||64);
    if(w*h<=maxPixels)return {width:w,height:h};
    const scale=Math.sqrt(maxPixels/(w*h));
    return {width:Math.max(64,Math.floor(w*scale/64)*64),height:Math.max(64,Math.floor(h*scale/64)*64)};
  }
  const ucTagsOf=(model,preset)=>preset==='heavy'?UC_HEAVY[familyOf(model)]:'';
  const qualityTagsOf=model=>QUALITY_TAGS[familyOf(model)];

  /* 把 {tag} 换成画师 tag。未知的花括号变量原样保留，方便用户自己发现拼错了。 */
  function fillTemplate(template,vars={}){
    return String(template??'').replace(/\{(\w+)\}/g,(all,key)=>Object.prototype.hasOwnProperty.call(vars,key)?String(vars[key]):all);
  }
  /* V5/V4 要求 negative_prompt 与 v4_negative_prompt.caption.base_caption 同步，
     少了任何一处服务器都会直接报内部错误。 */
  function buildBody(settings={},prompt=''){
    const model=MODELS.some(m=>m.value===settings.model)?settings.model:MODELS[0].value;
    const preset=UC_PRESETS.some(p=>p.value===settings.ucPreset)?settings.ucPreset:'heavy';
    const sampler=SAMPLERS.some(s=>s.value===settings.sampler)?settings.sampler:'k_euler_ancestral';
    const size=sizeOf(settings.size);
    const finalPrompt=String(prompt)+qualityTagsOf(model);
    const finalUc=ucTagsOf(model,preset)+String(settings.negativePrompt??'');
    const steps=Number.isSafeInteger(settings.steps)&&settings.steps>0?settings.steps:28;
    const scale=Number.isFinite(settings.scale)&&settings.scale>=0?settings.scale:5;
    /* Prompt Guidance Rescale（站点 UI 就叫这个名字）：0–1，越大越压高引导带来的过曝。 */
    const cfgRescale=Number.isFinite(settings.cfgRescale)&&settings.cfgRescale>=0&&settings.cfgRescale<=1?settings.cfgRescale:0;
    const seed=Number.isSafeInteger(settings.seed)&&settings.seed>=0?settings.seed:Math.floor(Math.random()*4294967295);
    const parameters={
      cfg_rescale:cfgRescale,controlnet_strength:1,dynamic_thresholding:false,skip_cfg_above_sigma:null,
      legacy:false,legacy_uc:false,legacy_v3_extend:false,n_samples:1,
      negative_prompt:finalUc,params_version:3,noise_schedule:'native',qualityToggle:false,
      sampler,scale,seed,steps,
      width:nearest64(clamp(settings.width||size.width,64,2048)),height:nearest64(clamp(settings.height||size.height,64,2048)),
    };
    const body={action:'generate',input:finalPrompt,model,parameters};
    if(isV4x(model)){
      parameters.use_coords=false;parameters.prefer_brownian=true;parameters.deliberate_euler_ancestral_bug=false;
      parameters.noise_schedule='karras';
      parameters.v4_negative_prompt={legacy_uc:false,caption:{base_caption:finalUc,char_captions:[]}};
      parameters.v4_prompt={use_coords:false,use_order:true,caption:{base_caption:finalPrompt,char_captions:[]}};
    }
    if(isV5(model)){
      parameters.params_version=4;
      parameters.ucPresetId=preset;
      parameters.qualityPresetId='standard';
      parameters.tag_hint_qt=1;parameters.tag_hint_uc_preset=2;
      parameters.normalize_reference_strength_multiple=true;
      parameters.image_format='png';
      parameters.inpaintImg2ImgStrength=1;parameters.add_original_image=true;
      delete parameters.sm;delete parameters.sm_dyn;delete parameters.qualityToggle;delete parameters.skip_cfg_above_sigma;
      /* 透明背景是 V5 独有的原生 Alpha 输出，站点客户端就是这么发的三个字段。
         别的模型不发：buildBody 不认识就当作没开，由调用方在发请求前把话说明白。 */
      if(settings.transparentBg===true){parameters.tag_hint_transparent_background=true;parameters.straight_alpha=true;parameters.image_format='png';}
    }
    return body;
  }

  /* 从 zip 里取出第一张图片。优先读中央目录：本地头里的长度字段在流式写入时可能是 0。 */
  async function firstImageFromZip(bytes){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let eocd=-1;
    for(let i=bytes.length-22;i>=0&&i>=bytes.length-22-65536;i--)if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
    if(eocd<0)throw Error('返回的内容不是有效的压缩包');
    const count=view.getUint16(eocd+10,true);let p=view.getUint32(eocd+16,true);
    for(let n=0;n<count;n++){
      if(view.getUint32(p,true)!==0x02014b50)throw Error('压缩包中央目录损坏');
      const method=view.getUint16(p+10,true),compSize=view.getUint32(p+20,true);
      const nameLen=view.getUint16(p+28,true),extraLen=view.getUint16(p+30,true),commentLen=view.getUint16(p+32,true);
      const localOffset=view.getUint32(p+42,true),name=new TextDecoder().decode(bytes.subarray(p+46,p+46+nameLen));
      p+=46+nameLen+extraLen+commentLen;
      if(!/\.(png|jpe?g|webp)$/i.test(name))continue;
      const start=localOffset+30+view.getUint16(localOffset+26,true)+view.getUint16(localOffset+28,true);
      const data=bytes.subarray(start,start+compSize);
      if(method===0)return new Blob([data],{type:'image/png'});
      if(method!==8)throw Error('压缩包用了不支持的压缩方式：'+method);
      const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Blob([await new Response(stream).arrayBuffer()],{type:'image/png'});
    }
    throw Error('压缩包里没有图片');
  }

  const api={fillTemplate,buildBody,firstImageFromZip,fitPixels,ENDPOINT,MODELS,SIZES,SAMPLERS,UC_PRESETS,QUALITY_TAGS,UC_HEAVY,isV5,isV4x,familyOf,nearest64,MAX_PIXELS,FREE_PIXELS,FREE_STEPS};
  root.ArtistNovelAI=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
