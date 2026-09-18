(function(root){
  'use strict';
  const origin='https://danbooru.donmai.us';
  /* 排序元标签由这里拼进查询，所以限定成小写字母与下划线，避免拼出意外的查询 */
  const orderTag=value=>/^[a-z][a-z_]*$/.test(String(value||''))?String(value):'id_desc';
  /* 优先走扩展：它带登录 Cookie，图片地址字段只对"可见用户"返回，页面匿名直连拿不到。
     扩展不在、或版本太旧不认接口通道时退回页面直连，数量类接口照常可用。
     返回形状与 fetch 的 Response 一致（ok/status/json）。 */
  async function defaultFetcher(url,init={}){
    const bridge=root.ArtistExtension;
    if(bridge&&bridge.canFetchApi===true&&typeof bridge.api==='function')return bridge.api(url,init?.signal);
    return fetch(url,init);
  }
  function plan(value){
    const input=String(value).trim();
    if(!input)throw Error('请输入画师标签或主页 URL。');
    if(input.length>1200)throw Error('输入过长，请使用画师标签或简短的主页链接。');
    let query=input,kind='name',id=null;
    if(/^\d+$/.test(input)){id=input;kind='id';}
    else if(/^https?:\/\//i.test(input)||/^(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\//i.test(input)){
      const u=new URL(/^https?:/i.test(input)?input:'https://'+input);
      if(u.username||u.password)throw Error('请不要使用含账号密码的 URL。');
      u.hash='';query=u.href;kind='url';
      if(u.hostname==='danbooru.donmai.us'){
        const m=u.pathname.match(/^\/artists\/(\d+)(?:\.json)?\/?$/);
        if(m){id=m[1];kind='id';}
        else if(u.pathname==='/artists/show_or_new'&&u.searchParams.get('name')){query=u.searchParams.get('name');kind='name';}
      }
    }else if(input.includes('://'))throw Error('仅支持 http:// 或 https:// 主页链接。');
    else query=input.replace(/^@/,'').replace(/\s+/g,'_');
    if(kind==='id'&&(!Number.isSafeInteger(Number(id))||Number(id)<1))throw Error('请输入有效的 Danbooru 画师编号。');
    const params=new URLSearchParams({limit:'12'});
    params.set(kind==='id'?'search[id]':'search[any_name_or_url_matches]',kind==='id'?id:query);
    return {input,query,kind,siteUrl:origin+'/artists?'+params,apiUrl:kind==='id'?origin+'/artists/'+id+'.json':origin+'/artists.json?'+params};
  }
  function candidates(payload){
    const rows=Array.isArray(payload)?payload:[payload];const seen=new Set();
    return rows.filter(a=>a&&Number.isSafeInteger(a.id)&&a.id>0&&typeof a.name==='string'&&a.name.trim()&&!a.is_deleted&&!seen.has(a.id)&&seen.add(a.id)).slice(0,12).map(a=>({id:a.id,name:a.name,aliases:Array.isArray(a.other_names)?a.other_names.filter(x=>typeof x==='string'&&x.trim()).slice(0,60):[],pageUrl:origin+'/artists/'+a.id}));
  }
  async function lookup(p,{signal,fetcher=defaultFetcher}={}){
    const response=await fetcher(p.apiUrl,{signal,credentials:'omit',headers:{Accept:'application/json'}});
    if(response.status===404)return [];
    if(!response.ok)throw Error(response.status===429?'请求过于频繁，请稍后重试。':'Danbooru 暂时未允许访问（'+response.status+'）。请使用站内检索核验。');
    let payload;try{payload=await response.json();}catch{throw Error('站点未返回画师数据，请使用站内检索核验。');}
    if(!Array.isArray(payload)&&!(payload&&Number.isSafeInteger(payload.id)&&typeof payload.name==='string'))throw Error('站点未返回画师数据，请使用站内检索核验。');
    return candidates(payload);
  }
  const workOf=post=>{
    const variants=Array.isArray(post.media_asset?.variants)?post.media_asset.variants:[];
    const pick=type=>variants.find(v=>v&&v.type===type&&typeof v.url==='string')?.url;
    const https=value=>typeof value==='string'&&value.startsWith('https://')?value:null;
    const small=https(post.preview_file_url)||https(pick('180x180'));
    const thumbUrl=https(pick('360x360'))||(small?small.replace('/180x180/','/360x360/'):null)||small;
    return {id:String(post.id),url:origin+'/posts/'+post.id,caption:'',
      thumbUrl,
      previewUrl:https(pick('720x720'))||https(pick('360x360')),
      largeUrl:https(post.file_url)||https(pick('original'))||https(post.large_file_url)||https(pick('720x720'))};
  };
  async function posts(name,{limit=20,page=1,signal,fetcher=defaultFetcher,order='id_desc'}={}){
    const params=new URLSearchParams({tags:name+' order:'+orderTag(order),limit:String(limit),page:String(page)});
    const response=await fetcher(origin+'/posts.json?'+params,{signal,credentials:'omit',headers:{Accept:'application/json'}});
    if(!response.ok)throw Error(response.status===429?'请求过于频繁，请稍后重试。':'作品列表读取失败（'+response.status+'）。');
    let payload;try{payload=await response.json();}catch{throw Error('站点未返回作品数据，请稍后重试。');}
    if(!Array.isArray(payload))throw Error('站点未返回作品数据，请稍后重试。');
    return payload.filter(post=>post&&Number.isSafeInteger(post.id)&&post.id>0).map(workOf);
  }
  async function details(name,date,{fetcher=defaultFetcher,previews=true,order='id_desc'}={}){
    const get=async(endpoint,params)=>{const r=await fetcher(origin+endpoint+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(15000),credentials:'omit',headers:{Accept:'application/json'}});if(!r.ok)throw Error('读取受限：'+r.status);return r.json();};
    const checkedAt=new Date().toISOString();
    const count=async(tags)=>{const j=await get('/counts/posts.json',{tags,estimate_count:'false'});const n=j?.counts?.posts;if(!Number.isSafeInteger(n)||n<0)throw Error('数量未返回');return n;};
    const jobs=[count(name),previews?get('/posts.json',{tags:name+' order:'+orderTag(order),limit:'5'}):Promise.resolve([])];
    if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date))jobs.push(count(name+' date:<'+date));
    const results=await Promise.allSettled(jobs),ok=i=>results[i]?.status==='fulfilled';
    const counts={checkedAt,total:ok(0)?results[0].value:null,beforeDate:date||null,beforeTotal:ok(2)?results[2].value:null};
    const rows=ok(1)&&Array.isArray(results[1].value)?results[1].value:[];
    const works=rows.filter(post=>post&&Number.isSafeInteger(post.id)&&post.id>0).map(workOf);
    return {counts,works,previewError:!ok(1),countsError:!ok(0)||(!!date&&!ok(2))};
  }
  const api={plan,candidates,lookup,posts,details,workOf};root.ArtistLookup=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
