import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ArtistLookup=require('./app/artist-lookup.js');

/* yotte615 这类字符串可能只出现在画师的主页地址里，不在名字、组名或别名里。
   名字类搜索永远搜不到它；只有 url_matches 能命中（该参数不带通配符时会自动首尾补 *）。 */
test('按主页地址搜用 url_matches，与名字搜索是两个不同参数',()=>{
  const byUrl=ArtistLookup.plan('yotte615',{match:'url'});
  assert.equal(new URL(byUrl.apiUrl).searchParams.get('search[url_matches]'),'yotte615');
  assert.equal(new URL(byUrl.siteUrl).searchParams.get('search[url_matches]'),'yotte615','站内检索链接也要带上同一个条件');
  assert.equal(new URL(byUrl.apiUrl).searchParams.get('search[any_name_matches]'),null,'不能再混进名字条件');
});
test('三种搜索各对应一个用户能在站点上点到的字段',()=>{
  const params=options=>new URL(ArtistLookup.plan('yotte615',options).apiUrl).searchParams;
  assert.equal(params({match:'name'}).get('search[any_name_matches]'),'yotte615');
  assert.equal(params({}).get('search[any_name_or_url_matches]'),'yotte615');
  assert.equal(params({match:'url'}).get('search[url_matches]'),'yotte615');
});
test('编号输入不受 match 影响，仍然直取那一条记录',()=>{
  for(const options of [{match:'name'},{match:'url'},{}]){
    const p=ArtistLookup.plan('196870',options);
    assert.equal(p.kind,'id');
    assert.match(p.apiUrl,/\/artists\/196870\.json$/);
  }
});
test('@前缀与空格照旧先清洗，再进 URL 搜索',()=>{
  const p=ArtistLookup.plan('@yotte 615',{match:'url'});
  assert.equal(p.query,'yotte_615');
  assert.equal(new URL(p.apiUrl).searchParams.get('search[url_matches]'),'yotte_615');
});

/* ── 回归：详情读取的三路请求各拿一份独立预算 ─────────────────────────── */

/* 以往三路共用一个 15 秒信号：大标签的数量统计能跑十几秒，一到点就把同一批里
   已经快回来的作品列表一起掐掉——编号和数量都写进去了，缩略图却一张不剩，
   而且失败原因连说都不说（mikazukimo_4780 就是这么丢的）。 */
const okJson=body=>({ok:true,status:200,json:async()=>body});
const post=id=>({id,preview_file_url:'https://cdn.donmai.us/180x180/x'+id+'.jpg'});
test('每路请求各带自己的超时预算，慢的数量不会掐断作品列表',async()=>{
  const seen=[];
  const fetcher=async(url,init)=>{
    seen.push({path:new URL(url).pathname,timeoutMs:init.timeoutMs});
    if(new URL(url).pathname==='/counts/posts.json')return okJson({counts:{posts:4780}});
    return okJson([post(1)]);
  };
  await ArtistLookup.details('mikazukimo_4780','2026-07-01',{order:'favcount',fetcher,timeout:20000});
  assert.equal(seen.length,3,'数量两路 + 作品一路');
  assert.equal(seen.every(item=>item.timeoutMs>0),true,'每一路都要有自己的上限：'+JSON.stringify(seen));
  assert.equal(seen.every(item=>!('signal' in item)||item.signal===undefined),true,'默认不该再套用调用层写死的共用信号');
});
test('作品列表失败时重试一次，数量那一路失败不重试',async()=>{
  const asked={counts:0,posts:0};
  const fetcher=async url=>{
    const path=new URL(url).pathname;
    if(path==='/posts.json'){asked.posts++;throw new DOMException('The operation was aborted due to timeout','TimeoutError');}
    asked.counts++;return okJson({counts:{posts:3}});
  };
  const detail=await ArtistLookup.details('iuui','2026-07-01',{fetcher,retryDelay:1});
  assert.equal(asked.posts,2,'作品列表只重试这一路');
  assert.equal(asked.counts,2,'数量那两路不跟着重试，别为一项再压一次站点');
  assert.equal(detail.works.length,0);
  assert.equal(detail.previewError,'读取超时','要把「为什么没读到」带出去：'+detail.previewError);
  assert.equal(detail.countsError,false,'数量读到了就不算失败');
  assert.equal(detail.counts.total,3);
});
test('重试仍然失败时，previewError 带上真实原因，不再只给一个布尔',async()=>{
  const fetcher=async url=>{
    if(new URL(url).pathname==='/posts.json')return {ok:false,status:500,json:async()=>null};
    return okJson({counts:{posts:9}});
  };
  const detail=await ArtistLookup.details('iuui','2026-07-01',{fetcher,retryDelay:1});
  assert.match(detail.previewError,/HTTP 500/,'失败原因要能追到状态码：'+detail.previewError);
  assert.equal(detail.works.length,0);
});
test('作品列表正常时 previewError 是空串，判断方式不变',async()=>{
  const fetcher=async url=>new URL(url).pathname==='/posts.json'?okJson([post(7)]):okJson({counts:{posts:1}});
  const detail=await ArtistLookup.details('iuui','',{fetcher});
  assert.equal(detail.previewError,'');
  assert.equal(detail.works.length,1);
});
test('详情读取超时上限可调：不同调用方各有各的宽紧',async()=>{
  const seen=[];
  const fetcher=async(url,init)=>{seen.push(init.timeoutMs);return new URL(url).pathname==='/posts.json'?okJson([]):okJson({counts:{posts:1}});};
  await ArtistLookup.details('iuui','',{fetcher,timeout:45000});
  assert.equal(seen.every(value=>value>0&&value<=45000),true,'每一路都不该超过本次给定的总预算：'+JSON.stringify(seen));
  assert.equal(seen.some(value=>value===45000),true,'默认就是这次给的总预算，而不是写死的 15 秒');
});
/* 打开作品列表（WorkPicker）没带 signal 时也要有自己的上限，不能挂死在那里。 */
test('作品列表翻页：自带 signal 时听 signal，没带时给自己的超时',async()=>{
  const seen=[];
  const fetcher=async(url,init)=>{seen.push({signal:init.signal,timeoutMs:init.timeoutMs});return okJson([]);};
  const controller=new AbortController();
  await ArtistLookup.posts('iuui',{fetcher,signal:controller.signal});
  await ArtistLookup.posts('iuui',{fetcher});
  assert.equal(seen[0].signal,controller.signal,'调用方自带 signal 时不另起一个');
  assert.equal(seen[0].timeoutMs,undefined);
  assert.equal(seen[1].signal,undefined);
  assert.equal(seen[1].timeoutMs,20000,'没带 signal 时要有兜底上限');
});
