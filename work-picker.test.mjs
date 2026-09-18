import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.className='';this.textContent='';this.dataset={};this.hidden=false;this.type='';this.checked=false;this.onclick=null;this.onchange=null;this.href='';}
  append(...nodes){for(const node of nodes)this.children.push(node);}
  replaceChildren(...nodes){this.children=nodes.slice();}
  setAttribute(){}
}
const setup=async posts=>{
  const bound=[];
  const context={document:{createElement:tag=>new Element(tag)},ArtistLookup:{posts},ArtistImages:{bind:(img,uid,work)=>bound.push(work.id),dispose(){}}};
  vm.runInNewContext(await fs.readFile('app/work-picker.js','utf8'),context);
  return {context,bound};
};
const page=ids=>ids.map(id=>({id,thumbUrl:'https://cdn.donmai.us/180x180/'+id+'.jpg'}));
test('作品勾选器默认全选、跳过库里已有的，并能继续翻页',async()=>{
  const calls=[];
  const {context,bound}=await setup(async(tag,{page:number})=>{calls.push({tag,page:number});return number===1?page(Array.from({length:20},(_,i)=>String(i+1))):page(['21','22']);});
  const container=new Element();
  const picker=context.WorkPicker.mount(container,{uid:'u1',tag:'artist_a',exclude:new Set(['2'])});
  await picker.ready;
  const [status,grid,tools]=container.children;
  assert.deepEqual(calls,[{tag:'artist_a',page:1}],'首屏只取第一页');
  assert.equal(grid.children.length,19,'库中已有的 #2 不再列出');
  assert.equal(bound.length,19,'每张都绑定了缩略图');
  assert.equal(picker.selected().length,0,'默认一张都不勾选');
  assert.equal(tools.children[0].textContent.includes('已选 0 / 19'),true);
  assert.equal(status.textContent.includes('19 张作品'),true);
  const firstBox=grid.children[0].children[0];
  firstBox.checked=true;firstBox.onchange();
  assert.equal(picker.selected().length,1,'勾选后计入');
  tools.children[1].onclick();
  assert.equal(picker.selected().length,19,'全选');
  tools.children[2].onclick();
  assert.equal(picker.selected().length,0,'全不选清空勾选');
  await tools.children[3].onclick();
  assert.deepEqual(calls,[{tag:'artist_a',page:1},{tag:'artist_a',page:2}]);
  assert.equal(picker.selected().length,0,'新加载的一页同样默认不勾选');
  assert.equal(tools.children[3].hidden,true,'取满不足一页后隐藏加载更多');
});
test('点作品编号触发放大回调，销毁后释放图片绑定',async()=>{
  const disposed=[];
  const {context}=await setup(async()=>page(['7']));
  context.ArtistImages.dispose=group=>disposed.push(group);
  const container=new Element(),seen=[];
  const picker=context.WorkPicker.mount(container,{uid:'u2',tag:'artist_b',onPreview:work=>seen.push(work.id)});
  await picker.ready;
  const label=container.children[1].children[0],idButton=label.children[2];
  idButton.onclick();
  assert.deepEqual(seen,['7'],'点编号放大而不是跳转站点');
  picker.dispose();
  assert.deepEqual(disposed,['picker:u2']);
  assert.equal(container.children.length,0,'销毁后清空容器');
});
test('作品列表读取失败时如实提示，不抛到调用方',async()=>{
  const {context}=await setup(async()=>{throw Error('作品列表读取失败（429）。');});
  const container=new Element();
  const picker=context.WorkPicker.mount(container,{uid:'u3',tag:'artist_c'});
  await picker.ready;
  assert.equal(container.children[0].textContent,'作品读取失败：作品列表读取失败（429）。');
  assert.equal(picker.selected().length,0,'读取失败时没有可选作品');
});
