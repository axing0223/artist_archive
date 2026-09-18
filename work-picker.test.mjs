import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.className='';this.textContent='';this.dataset={};this.hidden=false;this.type='';this.checked=false;this.onclick=null;this.onchange=null;this.oninput=null;this.href='';this.value='';this.title='';this.props={};this.style={setProperty:(k,v)=>{this.props[k]=v;},getProperty:k=>this.props[k]||''};}
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
  const zoomBar=tools.children[0];
  assert.deepEqual(calls,[{tag:'artist_a',page:1}],'首屏只取第一页');
  assert.equal(grid.children.length,19,'库中已有的 #2 不再列出');
  assert.equal(bound.length,19,'每张都绑定了缩略图');
  assert.equal(picker.selected().length,0,'默认一张都不勾选');
  assert.equal(tools.children[1].textContent.includes('已选 0 / 19'),true);
  assert.equal(status.textContent.includes('19 张作品'),true);
  const firstBox=grid.children[0].children[0];
  firstBox.checked=true;firstBox.onchange();
  assert.equal(picker.selected().length,1,'勾选后计入');
  tools.children[2].onclick();
  assert.equal(picker.selected().length,19,'全选');
  tools.children[3].onclick();
  assert.equal(picker.selected().length,0,'全不选清空勾选');
  await tools.children[4].onclick();
  assert.deepEqual(calls,[{tag:'artist_a',page:1},{tag:'artist_a',page:2}]);
  assert.equal(picker.selected().length,0,'新加载的一页同样默认不勾选');
  assert.equal(zoomBar.className,'picker-zoom','预览大小滑动条也在这一行工具栏里');
  assert.equal(picker.tools,tools,'工具栏暴露给调用方，便于固定放入自己的按钮');
  assert.equal(tools.children[4].hidden,true,'取满不足一页后隐藏加载更多');
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
test('预览尺寸滑动条改变缩略图大小，识别区与编辑页保持同步',async()=>{
  const {context}=await setup(async()=>page(['1','2']));
  const zoom={thumbHeight:120,listeners:new Set(),
    setThumbHeight(value){this.thumbHeight=value;for(const fn of this.listeners)fn(value);},
    subscribe(fn){this.listeners.add(fn);},unsubscribe(fn){this.listeners.delete(fn);}};
  const first=new Element(),second=new Element();
  const a=context.WorkPicker.mount(first,{uid:'z1',tag:'t',zoom}),b=context.WorkPicker.mount(second,{uid:'z2',tag:'t',zoom});
  await Promise.all([a.ready,b.ready]);
  const rangeA=first.children[2].children[0].children[1],rangeB=second.children[2].children[0].children[1],gridA=first.children[1],gridB=second.children[1];
  assert.equal(rangeA.value,'120','滑动条初值来自共享偏好');
  assert.equal(gridA.style.getProperty('--pick-size'),'120px');
  rangeA.value='180';rangeA.oninput();
  assert.equal(zoom.thumbHeight,180);
  assert.equal(gridA.style.getProperty('--pick-size'),'180px');
  assert.equal(gridB.style.getProperty('--pick-size'),'180px','另一处的预览同步跟着变');
  assert.equal(rangeB.value,'180','另一处的滑动条位置也同步');
  a.dispose();
  rangeB.value='90';rangeB.oninput();
  assert.equal(zoom.thumbHeight,90);
  b.dispose();
});
test('作品勾选器可以就地换排序，换完重新取并清空勾选',async()=>{
  const calls=[];
  class Option{constructor(text,value){this.textContent=text;this.value=value;}}
  const context={document:{createElement:tag=>new Element(tag)},Option,
    ArtistLookup:{posts:async(tag,options)=>{calls.push({tag,...options});return page(['1','2','3']);}},
    ArtistImages:{bind(){},dispose(){}}};
  vm.runInNewContext(await fs.readFile('app/work-picker.js','utf8'),context);
  const container=new Element();
  const picker=context.WorkPicker.mount(container,{uid:'o1',tag:'artist_d',order:'favcount',
    orderOptions:[{value:'favcount',label:'收藏最多'},{value:'score',label:'评分最高'}]});
  await picker.ready;
  const tools=container.children[2],orderBar=tools.children[1],select=orderBar.children[1];
  assert.equal(orderBar.className,'picker-order','排序选择器与预览大小同一行');
  assert.equal(select.value,'favcount','初值来自调用方传进来的排序');
  assert.equal(select.children.map(option=>option.value).join(','),'favcount,score');
  assert.deepEqual(calls,[{tag:'artist_d',limit:20,page:1,order:'favcount'}],'首屏按传入的排序取');
  tools.children[3].onclick();
  assert.equal(picker.selected().length,3,'先勾满，验证换排序会清空');
  select.value='score';await select.onchange();
  assert.deepEqual(calls[1],{tag:'artist_d',limit:20,page:1,order:'score'},'换排序后重新从第一页取');
  assert.equal(picker.selected().length,0,'换排序要清空勾选，否则会出现「已选」却看不到');
  assert.equal(String(container.children[0].textContent).includes('评分最高'),true,'提示里说明按哪个排序');
  assert.equal(tools.children.length,6,'没传排序选项时不插入多余控件');
});
test('没传排序选项时不出现排序控件，工具栏位置不变',async()=>{
  const {context}=await setup(async()=>page(['1','2']));
  const container=new Element();
  const picker=context.WorkPicker.mount(container,{uid:'o2',tag:'artist_e'});
  await picker.ready;
  const tools=container.children[2];
  assert.equal(tools.children.length,5,'只有预览大小、计数、全选、全不选、加载更多');
  assert.equal(tools.children[0].className,'picker-zoom');
  assert.equal(tools.children[1].textContent.includes('已选'),true,'计数紧跟在预览大小后面');
  picker.dispose();
});
test('作品列表读取失败时如实提示，不抛到调用方',async()=>{
  const {context}=await setup(async()=>{throw Error('作品列表读取失败（429）。');});
  const container=new Element();
  const picker=context.WorkPicker.mount(container,{uid:'u3',tag:'artist_c'});
  await picker.ready;
  assert.equal(container.children[0].textContent,'作品读取失败：作品列表读取失败（429）。');
  assert.equal(picker.selected().length,0,'读取失败时没有可选作品');
});
