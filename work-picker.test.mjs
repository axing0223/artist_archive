import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
class Element{
  constructor(tag='div'){
    this.tagName=tag;this.children=[];this.className='';this.textContent='';this.dataset={};this.hidden=false;this.type='';this.checked=false;this.disabled=false;
    this.onclick=null;this.onchange=null;this.oninput=null;this.href='';this.value='';this.title='';this.props={};
    this.style={setProperty:(k,v)=>{this.props[k]=v;},getProperty:k=>this.props[k]||''};
    this.classList={
      add:(...names)=>{const list=String(this.className).split(/\s+/).filter(Boolean);for(const name of names)if(!list.includes(name))list.push(name);this.className=list.join(' ');},
      remove:(...names)=>{const drop=new Set(names);this.className=String(this.className).split(/\s+/).filter(name=>name&&!drop.has(name)).join(' ');},
      toggle:(name,force)=>{const on=force===undefined?!this.classList.contains(name):!!force;if(on)this.classList.add(name);else this.classList.remove(name);return on;},
      contains:name=>String(this.className).split(/\s+/).includes(name),
    };
  }
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
test('勾上即加入、取消即移出，加载更多只补新格子不重建旧的',async()=>{
  const calls=[],added=[];
  const {context,bound}=await setup(async(tag,{page:number})=>{calls.push({tag,page:number});return number===1?page(Array.from({length:20},(_,i)=>String(i+1))):page(['21','22']);});
  const container=new Element();
  const picker=context.WorkPicker.mount(container,{uid:'u1',tag:'artist_a',exclude:new Set(['2']),
    onAdd:async work=>{added.push(work.id);},onRemove:async work=>{added.splice(added.indexOf(work.id),1);}});
  await picker.ready;
  const [status,grid,tools]=container.children;
  assert.deepEqual(calls,[{tag:'artist_a',page:1}],'首屏只取第一页');
  assert.equal(grid.children.length,19,'库中已有的 #2 不再列出');
  assert.equal(bound.length,19,'每张都绑定了缩略图');
  assert.deepEqual([...picker.added()],[],'默认一张都不加');
  assert.equal(tools.children[1].textContent.includes('已加入 0 / 本页 19'),true);
  assert.equal(status.textContent.includes('19 张作品'),true);
  const firstLabel=grid.children[0],firstBox=firstLabel.children[0];
  firstBox.checked=true;await firstBox.onchange();
  assert.deepEqual(added,['1'],'勾上就完成加入');
  assert.deepEqual([...picker.added()],['1']);
  assert.equal(firstLabel.className.includes('is-added'),true,'加过的格子要留标记');
  firstBox.checked=false;await firstBox.onchange();
  assert.deepEqual(added,[],'取消勾选就移出');
  assert.equal(firstLabel.className.includes('is-added'),false);
  await tools.children[2].onclick();
  assert.deepEqual(added.slice().sort(),Array.from({length:20},(_,i)=>String(i+1)).filter(id=>id!=='2').sort(),'全选＝全部加入（#2 本来就不在列表里）');
  await tools.children[3].onclick();
  assert.deepEqual(added,[],'全不选＝全部移出');
  /* 加载更多：只追加新格子。已经在列表里的格子必须还是原来那个节点——
     整体重建会让已经读出来的图全部重新淡入一遍，看着就是闪一下。 */
  const before=grid.children.slice();
  await tools.children[4].onclick();
  assert.deepEqual(calls,[{tag:'artist_a',page:1},{tag:'artist_a',page:2}]);
  assert.equal(grid.children.length,21);
  assert.equal(grid.children[0],before[0],'旧格子不能重建');
  assert.equal(grid.children[18],before[18],'旧格子不能重建');
  assert.equal(tools.children[4].hidden,true,'取满不足一页后隐藏加载更多');
  assert.equal(tools.children[0].className,'picker-zoom','预览大小滑动条也在这一行工具栏里');
  assert.equal(picker.tools,tools,'工具栏暴露给调用方，便于固定放入自己的按钮');
});
test('加入失败时勾选退回，并如实说明失败原因',async()=>{
  const {context}=await setup(async()=>page(['1']));
  const container=new Element();
  const picker=context.WorkPicker.mount(container,{uid:'u4',tag:'artist_f',onAdd:async()=>{throw Error('缩略图下载失败');}});
  await picker.ready;
  const label=container.children[1].children[0],box=label.children[0];
  box.checked=true;await box.onchange();
  assert.equal(box.checked,false,'失败要把勾退回去，不能让人以为加上了');
  assert.equal(container.children[0].textContent.includes('加入失败：缩略图下载失败'),true);
  assert.deepEqual([...picker.added()],[]);
  assert.equal(label.className.includes('is-added'),false);
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
test('换排序先不动旧列表，新的一批到了再整体换掉，已加入的照旧打勾',async()=>{
  const calls=[],added=[];let focused=0;
  class Option{constructor(text,value){this.textContent=text;this.value=value;}}
  const context={document:{createElement:tag=>new Element(tag)},Option,
    ArtistLookup:{posts:async(tag,options)=>{calls.push({tag,...options});return page(['1','2','3']);}},
    ArtistImages:{bind(){},dispose(){}}};
  vm.runInNewContext(await fs.readFile('app/work-picker.js','utf8'),context);
  const container=new Element();
  const picker=context.WorkPicker.mount(container,{uid:'o1',tag:'artist_d',order:'favcount',
    orderOptions:[{value:'favcount',label:'收藏最多'},{value:'score',label:'评分最高'}],
    onAdd:async work=>{added.push(work.id);},onRemove:async work=>{added.splice(added.indexOf(work.id),1);},onOrderChanged:()=>{focused++;}});
  await picker.ready;
  const grid=container.children[1],tools=container.children[2],orderBar=tools.children[1],select=orderBar.children[1];
  assert.equal(orderBar.className,'picker-order','排序选择器与预览大小同一行');
  assert.equal(select.value,'favcount','初值来自调用方传进来的排序');
  assert.equal(select.children.map(option=>option.value).join(','),'favcount,score');
  assert.deepEqual(calls,[{tag:'artist_d',limit:20,page:1,order:'favcount'}],'首屏按传入的排序取');
  await tools.children[3].onclick();
  assert.deepEqual(added.slice().sort(),['1','2','3'],'先都加入，验证换排序不会把它们丢掉');
  select.value='score';await select.onchange();
  assert.deepEqual(calls[1],{tag:'artist_d',limit:20,page:1,order:'score'},'换排序后重新从第一页取');
  assert.deepEqual([...picker.added()].sort(),['1','2','3'],'已经加入的作品不因为换排序被丢掉');
  assert.equal(focused,1,'换完排序要把视线交回画师作品');
  assert.equal(String(container.children[0].textContent).includes('评分最高'),true,'提示里说明按哪个排序');
  assert.equal(grid.children.length,3,'新的一批整体换掉旧列表');
  assert.equal(grid.children[0].children[0].checked,true,'重新列出来的已加入作品照旧打着勾');
  assert.equal(grid.children[0].className.includes('is-added'),true);
  assert.equal(tools.children.length,6,'带排序选项时才有那个排序控件');
});
test('没给 onAdd 时是纯勾选器，工具栏位置不变',async()=>{
  const {context}=await setup(async()=>page(['1','2']));
  const container=new Element();
  const picker=context.WorkPicker.mount(container,{uid:'o2',tag:'artist_e'});
  await picker.ready;
  const tools=container.children[2];
  assert.equal(tools.children.length,5,'只有预览大小、计数、全选、全不选、加载更多');
  assert.equal(tools.children[0].className,'picker-zoom');
  assert.equal(tools.children[1].textContent.includes('已选'),true,'计数紧跟在预览大小后面');
  /* 没有 onAdd 就只做勾选：勾选数量由 selected() 交给调用方，不打「已加入」标记。 */
  const label=container.children[1].children[0],box=label.children[0];
  box.checked=true;await box.onchange();
  assert.deepEqual([...picker.selected()].map(work=>work.id),['1'],'selected() 交出勾上的作品');
  assert.equal(label.className.includes('is-added'),false,'没真的加进去就不该打「已加入」标记');
  await tools.children[3].onclick();
  assert.deepEqual([...picker.selected()],[],'全不选清空勾选');
  picker.dispose();
});
test('作品列表读取失败时如实提示，不抛到调用方',async()=>{
  const {context}=await setup(async()=>{throw Error('作品列表读取失败（429）。');});
  const container=new Element();
  const picker=context.WorkPicker.mount(container,{uid:'u3',tag:'artist_c'});
  await picker.ready;
  assert.equal(container.children[0].textContent,'作品读取失败：作品列表读取失败（429）。');
  assert.deepEqual([...picker.added()],[],'读取失败时没有可加入的作品');
});
