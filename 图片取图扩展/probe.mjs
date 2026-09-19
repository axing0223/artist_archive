const MAX_BYTES=50*1024*1024;
const imageTypes=new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
export function imageUrl(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.hostname!=='cdn.donmai.us'||u.port||u.username||u.password)throw Error('图片地址仅支持 https://cdn.donmai.us/，不能含账号、密码或自定义端口。');
  u.hash='';return u.href;
}
export function postUrl(value){
  const s=String(value).trim(),match=s.match(/^(?:https:\/\/danbooru\.donmai\.us\/posts\/)?([1-9]\d*)(?:\.json)?\/?$/);
  if(!match||!Number.isSafeInteger(Number(match[1])))throw Error('请输入有效作品编号或 Danbooru 作品页面链接。');
  return 'https://danbooru.donmai.us/posts/'+match[1]+'.json';
}
export function apiUrl(value){
  const u=new URL(String(value));
  if(u.protocol!=='https:'||u.hostname!=='danbooru.donmai.us'||u.port||u.username||u.password)throw Error('接口地址仅支持 https://danbooru.donmai.us/，不能含账号、密码或自定义端口。');
  if(!u.pathname.endsWith('.json'))throw Error('接口地址必须以 .json 结尾。');
  u.hash='';return u.href;
}
/* 生图只放行 NovelAI 的文生图端点：页面送来的地址先在这里卡死，免得扩展被当成任意 POST 代理。 */
export function novelaiUrl(value){
  const u=new URL(String(value));
  if(u.protocol!=='https:'||u.hostname!=='image.novelai.net'||u.port||u.username||u.password)throw Error('生图地址仅支持 https://image.novelai.net/，不能含账号、密码或自定义端口。');
  if(u.pathname!=='/ai/generate-image')throw Error('生图地址只允许 /ai/generate-image。');
  u.hash='';u.search='';return u.href;
}
/* token 只做形状检查，不打印、不回传、不落盘。 */
export function bearerToken(value){
  const token=String(value??'');
  if(!/^[\x21-\x7e]{8,300}$/.test(token))throw Error('NovelAI token 格式无效：应当是 pst- 开头的一串字符，不能带空格或换行。');
  return token;
}
const SUBSCRIPTION_HOSTS=new Set(['image.novelai.net','api.novelai.net']);
/* 订阅/额度查询也走白名单：站点客户端用的是 /user/subscription，两个域名都能答。 */
export function subscriptionUrl(value){
  const u=new URL(String(value));
  if(u.protocol!=='https:'||!SUBSCRIPTION_HOSTS.has(u.hostname)||u.port||u.username||u.password)throw Error('额度地址仅支持 https://image.novelai.net/ 或 https://api.novelai.net/，不能含账号、密码或自定义端口。');
  if(u.pathname!=='/user/subscription')throw Error('额度地址只允许 /user/subscription。');
  u.hash='';u.search='';return u.href;
}
/* 只读订阅信息：用来显示套餐、Anlas 余额与 Opus 额度。返回原样 JSON，由网页解释。 */
export async function fetchSubscription(value,{token,fetcher=fetch,signal=AbortSignal.timeout(20000)}={}){
  const url=subscriptionUrl(value),authorization='Bearer '+bearerToken(token);
  const response=await fetcher(url,{method:'GET',credentials:'omit',signal,cache:'no-store',redirect:'error',headers:{accept:'application/json',authorization}});
  const declared=Number(response.headers.get('content-length'));
  if(declared>2*1024*1024){await response.body?.cancel();throw Error('订阅信息超过大小限制。');}
  const text=await response.text();
  if(response.status===401||response.status===403)throw Error('token 被拒绝，请重新生成 Persistent API Token。');
  if(!response.ok)throw Error('读取订阅信息失败：HTTP '+response.status+(text?'（'+text.slice(0,200)+'）':''));
  try{return JSON.parse(text);}catch{throw Error('订阅接口没有返回 JSON。');}
}
/* 带登录态取接口数据：图片地址字段只对"可见用户"返回，匿名请求拿不到 */
export async function fetchApi(value,{fetcher=fetch,signal=AbortSignal.timeout(20000)}={}){
  const response=await fetcher(apiUrl(value),{credentials:'include',signal,cache:'no-store',redirect:'error'});
  const declared=Number(response.headers.get('content-length'));
  if(declared>8*1024*1024){await response.body?.cancel();throw Error('接口返回超过大小限制。');}
  const type=(response.headers.get('content-type')||'').toLowerCase();
  if(!type.includes('application/json')){
    await response.body?.cancel();
    if(response.status===429)throw Error('请求过于频繁，请稍后重试。');
    throw Error('接口没有返回 JSON（HTTP '+response.status+'），可能仍被验证页拦截。');
  }
  const text=await response.text();
  if(!text.trim())return {status:response.status,json:null};
  try{return {status:response.status,json:JSON.parse(text)};}catch{throw Error('接口返回的内容不是 JSON。');}
}
const mb=n=>(n/1048576).toFixed(1);
async function limitedBlob(response,limit,signal){
  const declared=Number(response.headers.get('content-length'));
  if(declared>limit){await response.body?.cancel();throw Error('响应超过大小限制：'+mb(declared)+' MB，上限 '+mb(limit)+' MB。');}
  if(!response.body)throw Error('服务器没有返回内容。');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('响应超过大小限制：已超过上限 '+mb(limit)+' MB。');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  if(!size)throw Error('服务器返回空文件。');
  return new Blob(chunks,{type:response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()||''});
}
async function request(url,{credentials='include',fetcher=fetch,signal=AbortSignal.timeout(20000),report=()=>{}}={}){
  const response=await fetcher(url,{credentials,signal,cache:'no-store',redirect:'error'});
  const info={url,status:response.status,contentType:response.headers.get('content-type'),challenge:response.headers.get('cf-mitigated')};report(info);
  if(!response.ok||info.challenge==='challenge'){
    await response.body?.cancel();throw Error(info.challenge==='challenge'?'站点仍要求 Cloudflare 验证，扩展未能取得图片。':'服务器拒绝请求：HTTP '+response.status);
  }
  return {response,signal};
}
export async function fetchImage(value,options={}){
  const {response,signal}=await request(imageUrl(value),options);
  const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(!imageTypes.has(mime)){await response.body?.cancel();throw Error('收到 '+(mime||'未知类型')+'，不是图片。扩展没有解决站点拦截。');}
  return limitedBlob(response,Math.min(options.maxBytes||MAX_BYTES,MAX_BYTES),signal);
}
export async function resolvePost(value,options={}){
  const {response,signal}=await request(postUrl(value),options);
  if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')){await response.body?.cancel();throw Error('作品接口没有返回 JSON，可能仍被验证页拦截。');}
  const payload=JSON.parse(await (await limitedBlob(response,2*1024*1024,signal)).text());
  const candidate=payload.file_url||payload.media_asset?.variants?.find(v=>v.type==='original')?.url||payload.large_file_url||payload.preview_file_url;
  if(!candidate)throw Error('作品接口未提供图片地址。');
  return imageUrl(candidate);
}
const zipTypes=['application/zip','application/x-zip-compressed','application/octet-stream','binary/octet-stream'];
/* 文生图：POST 请求体由页面拼好（参数多、还会随模型变），扩展只负责发出去并把返回的 zip 带回来。
   出错的正文通常是 JSON，里面那句话比状态码有用得多，尽量原样带给用户。 */
export async function generateImage(value,body,{token,fetcher=fetch,signal=AbortSignal.timeout(180000),maxBytes=MAX_BYTES}={}){
  const url=novelaiUrl(value),authorization='Bearer '+bearerToken(token),payload=String(body??'');
  if(!payload||payload.length>200000)throw Error('生图参数为空或过大。');
  const response=await fetcher(url,{method:'POST',credentials:'omit',signal,cache:'no-store',redirect:'error',headers:{'content-type':'application/json',authorization},body:payload});
  const type=(response.headers.get('content-type')||'').toLowerCase();
  if(!response.ok||!zipTypes.some(item=>type.includes(item))){
    const text=await response.text().catch(()=>'');
    let message=text.slice(0,300);
    try{const parsed=JSON.parse(text);message=parsed.message||parsed.error||parsed.detail||message;}catch{}
    if(response.status===401||response.status===403)message='token 被拒绝，请重新生成 Persistent API Token。'+(message?'（'+message+'）':'');
    else if(response.status===402)message='Anlas 不足，或者这个模型需要 Opus 订阅。'+(message?'（'+message+'）':'');
    else if(response.status===429)message='请求过于频繁或已超出配额，稍后再试。'+(message?'（'+message+'）':'');
    throw Error('NovelAI 拒绝了请求：HTTP '+response.status+(message?'（'+message+'）':''));
  }
  const raw=await limitedBlob(response,Math.min(maxBytes,MAX_BYTES),signal);
  return new Blob([await raw.arrayBuffer()],{type:'application/zip'});
}
