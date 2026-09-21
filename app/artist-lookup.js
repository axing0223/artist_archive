(function(root){
  'use strict';
  const origin='https://danbooru.donmai.us';
  /* 排序元标签由这里拼进查询，所以限定成小写字母与下划线，避免拼出意外的查询 */
  const orderTag=value=>/^[a-z][a-z_]*$/.test(String(value||''))?String(value):'id_desc';
  /* 优先走扩展：它带登录 Cookie，图片地址字段只对"可见用户"返回，页面匿名直连拿不到。
     扩展不在、或版本太旧不认接口通道时退回页面直连，数量类接口照常可用。
     返回形状与 fetch 的 Response 一致（ok/status/json）。
     init.timeoutMs 是「本次请求自己的上限」：给了就按它掐断，不再套用调用层写死的超时——
     详情读取里几路请求开销差很多，共用一个信号时快的那路会被慢的那路一起掐掉。 */
  async function defaultFetcher(url,init={}){
    const {timeoutMs,...options}=init;
    if(timeoutMs>0&&!options.signal)options.signal=AbortSignal.timeout(timeoutMs);
    const bridge=root.ArtistExtension;
    if(bridge&&bridge.canFetchApi===true&&typeof bridge.api==='function')return bridge.api(url,options.signal);
    return fetch(url,options);
  }
  function plan(value,{match='any'}={}){
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
    /* 三种搜索各对应站点上的一个字段，也对应 /artists 页面上能点的三种条件：
       name = 名字 / 组名 / 别名；url = 画师主页地址（该参数不带通配符时会自动在首尾补 *）；
       默认的综合搜索只在输入本身是链接时才真的去搜 URL，所以它替代不了 url 这一路。 */
    const field=kind==='id'?'search[id]':match==='name'?'search[any_name_matches]':match==='url'?'search[url_matches]':'search[any_name_or_url_matches]';
    params.set(field,kind==='id'?id:query);
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
  async function posts(name,{limit=20,page=1,signal,fetcher=defaultFetcher,order='id_desc',timeoutMs}={}){
    const params=new URLSearchParams({tags:name+' order:'+orderTag(order),limit:String(limit),page:String(page)});
    /* 调用方自带 signal（翻页会把上一页掐掉）就听它的；没带时给一个自己的上限，
       免得一次请求挂死后整条采集链一直等。 */
    const response=await fetcher(origin+'/posts.json?'+params,{...(signal?{signal}:{timeoutMs:timeoutMs??20000}),credentials:'omit',headers:{Accept:'application/json'}});
    if(!response.ok)throw Error(response.status===429?'请求过于频繁，请稍后重试。':'作品列表读取失败（HTTP '+response.status+'）。');
    let payload;try{payload=await response.json();}catch{throw Error('站点未返回作品数据，请稍后重试。');}
    if(!Array.isArray(payload))throw Error('站点未返回作品数据，请稍后重试。');
    return payload.filter(post=>post&&Number.isSafeInteger(post.id)&&post.id>0).map(workOf);
  }
  /* 失败原因要说得出人话：内部信号被掐断是超时，站点/通道出错要带上状态码，
     否则界面上只会留下一句无法判断的「读取失败」。 */
  const reasonOf=error=>error?.name==='TimeoutError'||error?.name==='AbortError'?'读取超时':error?.message||String(error);
  async function details(name,date,{fetcher=defaultFetcher,previews=true,order='id_desc',timeout=20000,retryDelay=600,signal}={}){
    const openedAt=Date.now();
    /* 剩下的预算：整次详情读取共享一个上限，但每路请求各拿一份独立信号。
       共用一份信号时，慢的那一路（大标签的数量统计能跑十几秒）一到点就把同一批里
       已经快回来的作品列表一起掐掉——编号与数量都写进去了，缩略图却一张不剩。 */
    const budget=()=>{const left=timeout-(Date.now()-openedAt);if(left<=0)throw Error('读取超时');return left;};
    const get=async(endpoint,params,timeoutMs)=>{
      const url=origin+endpoint+'?'+new URLSearchParams(params);
      const r=await fetcher(url,{...(signal?{signal}:{}),credentials:'omit',headers:{Accept:'application/json'},timeoutMs:Math.min(timeoutMs??budget(),budget())});
      if(!r.ok)throw Error(endpoint+'：站点返回 HTTP '+r.status);
      return r.json();
    };
    const checkedAt=new Date().toISOString();
    const count=async(tags)=>{const j=await get('/counts/posts.json',{tags,estimate_count:'false'});const n=j?.counts?.posts;if(!Number.isSafeInteger(n)||n<0)throw Error('数量未返回');return n;};
    const countOf=tags=>{const task=count(tags);task.catch(()=>{});return task;};
    /* 作品列表只重试这一路：数量那一路失败只影响数量本身，不值得为它再压一次站点。
       重试共用同一份总预算，所以不会把一次采集拖成两倍长；预算已尽就不再试第二次。 */
    const worksOnce=()=>get('/posts.json',{tags:name+' order:'+orderTag(order),limit:'5'});
    const fetchWorks=async()=>{
      try{return await worksOnce();}
      catch(error){
        const wrapped=reasonOf(error);
        if(signal?.aborted)throw Error(wrapped);
        let left=0;try{left=budget();}catch{throw Error(wrapped);}
        if(left<=retryDelay)throw Error(wrapped);
        await new Promise(resolve=>setTimeout(resolve,retryDelay));
        return worksOnce();
      }
    };
    const jobs=[countOf(name),previews?fetchWorks():Promise.resolve([])];
    if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date))jobs.push(countOf(name+' date:<'+date));
    const results=await Promise.allSettled(jobs),ok=i=>results[i]?.status==='fulfilled';
    const counts={checkedAt,total:ok(0)?results[0].value:null,beforeDate:date||null,beforeTotal:ok(2)?results[2].value:null};
    const rows=ok(1)&&Array.isArray(results[1].value)?results[1].value:[];
    const works=rows.filter(post=>post&&Number.isSafeInteger(post.id)&&post.id>0).map(workOf);
    /* previewError 以往只是个布尔：调用方拿不到「为什么没读到」，只能干看着 0 张。
       现在失败时带原因（字符串），成功时为空串——仍然假值，判断方式不用改。 */
    return {counts,works,previewError:ok(1)?'':reasonOf(results[1].reason),countsError:!ok(0)||(!!date&&!ok(2))};
  }
  const api={plan,candidates,lookup,posts,details,workOf};root.ArtistLookup=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
