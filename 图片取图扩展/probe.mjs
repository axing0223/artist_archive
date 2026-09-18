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
