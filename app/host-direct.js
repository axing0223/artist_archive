(function(root){
  'use strict';
  /* 扩展页里的「直连」实现：页面本身就是 chrome-extension://，配上 host_permissions 的 fetch
     能带上站点 Cookie，所以取图、生图、查额度都不必再绕后台脚本，也没有消息协议与版本协商。
     导出的接口与 file:// 模式下的桥（extension-bridge.js）完全一致，app.js 不需要知道自己在哪个壳里。
     地址白名单与 file:// 模式的 probe.mjs 是同一套规则，两边各有一份实现、各有测试盯着。 */
  const DANBOORU='danbooru.donmai.us',CDN='cdn.donmai.us',NAI_IMAGE='image.novelai.net',NAI_API='api.novelai.net';
  const version=()=>{try{return String(chrome.runtime.getManifest().version||'');}catch{return '';}};
  function parse(value,label){
    let url;
    try{url=new URL(String(value));}catch{throw Error(label+'无效：'+value);}
    if(url.protocol!=='https:')throw Error(label+'仅支持 https。');
    if(url.port||url.username||url.password)throw Error(label+'不能含账号、密码或自定义端口。');
    return url;
  }
  const imageUrl=value=>{const url=parse(value,'图片地址');if(url.hostname!==CDN)throw Error('图片地址仅支持 https://'+CDN+'/。');url.hash='';return url.href;};
  const apiUrl=value=>{const url=parse(value,'接口地址');if(url.hostname!==DANBOORU)throw Error('接口地址仅支持 https://'+DANBOORU+'/。');if(!url.pathname.endsWith('.json'))throw Error('接口地址必须以 .json 结尾。');url.hash='';return url.href;};
  const postId=value=>{
    const text=String(value).trim(),match=text.match(/^(?:https:\/\/danbooru\.donmai\.us\/posts\/)?([1-9]\d*)(?:\.json)?\/?$/);
    if(!match||!Number.isSafeInteger(Number(match[1])))throw Error('请输入有效作品编号或 Danbooru 作品页面链接。');
    return 'https://'+DANBOORU+'/posts/'+match[1]+'.json';
  };
  const generateUrl=value=>{
    const url=parse(value,'生图地址');
    if(url.hostname!==NAI_IMAGE)throw Error('生图地址仅支持 https://'+NAI_IMAGE+'/。');
    if(url.pathname!=='/ai/generate-image')throw Error('生图地址只允许 /ai/generate-image。');
    url.hash='';url.search='';return url.href;
  };
  const subscriptionUrl=value=>{
    const url=parse(value,'额度地址');
    if(url.hostname!==NAI_IMAGE&&url.hostname!==NAI_API)throw Error('额度地址仅支持 '+NAI_IMAGE+' 或 '+NAI_API+'。');
    if(url.pathname!=='/user/subscription')throw Error('额度地址只允许 /user/subscription。');
    url.hash='';url.search='';return url.href;
  };
  const bearer=value=>{const text=String(value??'');if(!/^[\x21-\x7e]{8,300}$/.test(text))throw Error('NovelAI token 格式无效：应当是 pst- 开头的一串字符，不能带空格或换行。');return text;};
  const get=async(url,signal)=>fetch(url,{credentials:'include',cache:'no-store',redirect:'error',signal});
  async function image(url,signal){
    const response=await get(imageUrl(url),signal);
    if(!response.ok)throw Error(response.status===429?'请求过于频繁，请稍后重试。':'图片读取失败（HTTP '+response.status+'）。');
    const blob=await response.blob();
    if(!/^image\//.test(blob.type))throw Error('收到的不是图片：'+(blob.type||'未知类型'));
    return blob;
  }
  /* 取原图地址：图片字段只对登录用户返回，所以要带 Cookie；拿不到就如实报错。 */
  async function resolve(id,signal){
    const response=await get(postId(id),signal);
    if(!response.ok)throw Error('作品信息读取失败（HTTP '+response.status+'）。');
    const post=await response.json();
    const candidate=post.file_url||post.media_asset?.variants?.find(item=>item.type==='original')?.url||post.large_file_url||post.preview_file_url;
    if(!candidate)throw Error('这份作品没有可用的图片地址（可能已被删除或需要更高权限）。');
    return imageUrl(candidate);
  }
  async function api(url,signal){
    const response=await get(apiUrl(url),signal);
    const status=response.status;
    let json=null;
    try{json=await response.json();}catch{}
    return {ok:status>=200&&status<300,status,json:async()=>json};
  }
  /* 生图：请求体由页面拼好，这里只负责发出去并把返回的 zip 带回来。 */
  async function generate(body,token,signal){
    const payload=String(body??'');
    if(!payload||payload.length>200000)throw Error('生图参数为空或过大。');
    const response=await fetch(generateUrl('https://'+NAI_IMAGE+'/ai/generate-image'),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',signal,headers:{'content-type':'application/json',authorization:'Bearer '+bearer(token)},body:payload});
    const type=(response.headers.get('content-type')||'').toLowerCase();
    if(!response.ok||!/zip|octet-stream/.test(type)){
      const text=await response.text().catch(()=>'');
      let message=text.slice(0,300);
      try{const parsed=JSON.parse(text);message=parsed.message||parsed.error||parsed.detail||message;}catch{}
      if(response.status===401||response.status===403)message='token 被拒绝，请重新生成 Persistent API Token。'+(message?'（'+message+'）':'');
      else if(response.status===402)message='Anlas 不足，或者这个模型需要 Opus 订阅。'+(message?'（'+message+'）':'');
      else if(response.status===429)message='请求过于频繁或已超出配额，稍后再试。'+(message?'（'+message+'）':'');
      throw Error('NovelAI 拒绝了请求：HTTP '+response.status+(message?'（'+message+'）':''));
    }
    return response.blob();
  }
  async function subscription(url,token,signal){
    const response=await fetch(subscriptionUrl(url),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal,headers:{accept:'application/json',authorization:'Bearer '+bearer(token)}});
    const text=await response.text();
    if(response.status===401||response.status===403)throw Error('token 被拒绝，请重新生成 Persistent API Token。');
    if(!response.ok)throw Error('读取订阅信息失败：HTTP '+response.status+(text?'（'+text.slice(0,200)+'）':''));
    try{return JSON.parse(text);}catch{throw Error('订阅接口没有返回 JSON。');}
  }
  root.ArtistHostDirect={
    get connected(){return true;},
    get version(){return version();},
    get canFetchApi(){return true;},
    get canGenerate(){return true;},
    get canAccount(){return true;},
    get direct(){return true;},
    check:async()=>version(),
    resolve,image,api,generate,subscription,
    /* 供测试直接验规则 */
    rules:{imageUrl,apiUrl,postId,generateUrl,subscriptionUrl,bearer},
  };
  if(typeof module!=='undefined')module.exports=root.ArtistHostDirect;
})(globalThis);
