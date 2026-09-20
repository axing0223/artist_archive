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
