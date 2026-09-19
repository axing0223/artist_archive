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
  setAttribute(key,value){this[key]=value;}
  addEventListener(type,fn){(this.listeners||={})[type]=fn;}
  focus(){this.focused=true;}
  scrollIntoView(){this.scrolled=true;}
}
const setup=async posts=>{
  const bound=[];
  const context={AbortController,document:{createElement:tag=>new Element(tag)},ArtistLookup:{posts},ArtistImages:{bind:(img,uid,work)=>bound.push(work.id),dispose(){}}};
  vm.runInNewContext(await fs.readFile('app/work-picker.js','utf8'),context);
  return {context,bound};
};
const page=ids=>ids.map(id=>({id,thumbUrl:'https://cdn.donmai.us/180x180/'+id+'.jpg'}));

const all=(node,cls)=>[...(String(node.className).split(/\s+/).includes(cls)?[node]:[]),...node.children.flatMap(child=>all(child,cls))];
const get=(node,cls)=>all(node,cls)[0];
const buttons=node=>{const nav=get(node,'picker-pagination');return {previous:nav.children[0],next:nav.children[2]};};
const ids=(start,count)=>page(Array.from({length:count},(_,i)=>String(start+i)));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('分页每页最多21张，排除已有作品后补足，返回旧页不重复请求',async()=>{
 const calls=[];const {context}=await setup(async(tag,options)=>{calls.push(options);return options.page<3?ids((options.page-1)*21+1,21):ids(43,2);});
 const host=new Element(),picker=context.WorkPicker.mount(host,{uid:'u',tag:'artist',exclude:new Set(['2'])});await picker.ready;
 assert.equal(get(host,'candidate-previews').children.length,21);assert.equal(all(host,'pick').length,21);assert.equal(all(host,'pick')[20].children[2].textContent,'#22');
 assert.equal(calls.length,2,'排除已收录作品后补齐21张');assert.ok(calls.every(call=>call.limit===21));
 await buttons(host).next.onclick();assert.equal(all(host,'pick').length,21);assert.equal(all(host,'pick')[0].children[2].textContent,'#23');
 const count=calls.length;await buttons(host).previous.onclick();assert.equal(calls.length,count,'旧页读取已缓存元数据');
 await buttons(host).next.onclick();await buttons(host).next.onclick();assert.equal(all(host,'pick').length,1);assert.equal(get(host,'candidate-previews').children.length,21,'末页不足时保持3×7网格');assert.equal(buttons(host).next.disabled,true);
 assert.equal(get(host,'picker-page').textContent,'第 3 / 3 页');assert.equal(all(host,'picker-zoom').length,0);assert.equal(host.children.length,2,'仅顶部状态栏和作品网格');
 picker.dispose();assert.equal(host.children.length,0);
});

test('勾选即加入，跨页返回保留勾选，取消选择移出作品',async()=>{
 const {context}=await setup(async(tag,{page:p})=>p===1?ids(1,21):ids(22,2));const added=[];
 const host=new Element(),picker=context.WorkPicker.mount(host,{uid:'u',tag:'a',onAdd:async w=>added.push(w.id),onRemove:async w=>added.splice(added.indexOf(w.id),1)});await picker.ready;
 let box=all(host,'pick')[0].children[0];box.checked=true;await box.onchange();await buttons(host).next.onclick();box=all(host,'pick')[0].children[0];box.checked=true;await box.onchange();
 assert.deepEqual(added,['1','22']);assert.deepEqual([...picker.added()],['1','22']);await buttons(host).previous.onclick();box=all(host,'pick')[0].children[0];assert.equal(box.checked,true);box.checked=false;await box.onchange();assert.deepEqual(added,['22']);
});

test('仅勾选模式跨页保留完整selected结果，不会误加已加入标记',async()=>{
 const {context}=await setup(async(tag,{page:p})=>p===1?ids(1,21):ids(22,1));const host=new Element(),picker=context.WorkPicker.mount(host,{uid:'u',tag:'a'});await picker.ready;
 const choose=async()=>{const label=all(host,'pick')[0],box=label.children[0];box.checked=true;await box.onchange();assert.equal(label.classList.contains('is-added'),false);};
 await choose();await buttons(host).next.onclick();await choose();assert.deepEqual([...picker.selected()].map(w=>w.id),['1','22']);assert.match(get(host,'picker-count').textContent,/已选 2/);
});

test('加入失败还原勾选，异步加入期间不能翻页或换排序',async()=>{
 const request=gate();const {context}=await setup(async()=>ids(1,21));const host=new Element(),picker=context.WorkPicker.mount(host,{uid:'u',tag:'a',onAdd:()=>request.promise,orderOptions:[{label:'最新',value:'id_desc'}]});await picker.ready;
 const box=all(host,'pick')[0].children[0];box.checked=true;const pending=box.onchange();assert.equal(buttons(host).next.disabled,true);assert.equal(get(host,'picker-order').children[1].disabled,true);request.reject(Error('下载失败'));await pending;
 assert.equal(box.checked,false);assert.equal(buttons(host).next.disabled,false);assert.match(get(host,'picker-message').textContent,/加入失败：下载失败/);assert.equal(picker.added().length,0);
});

test('切换排序保留旧列表直到成功，旧请求晚到不能覆盖新排序',async()=>{
 const first=gate(),second=gate();const {context}=await setup(async(tag,{order})=>order==='score'?first.promise:order==='favcount'?second.promise:ids(1,2));
 const host=new Element(),picker=context.WorkPicker.mount(host,{uid:'u',tag:'a',orderOptions:[{label:'最新',value:'id_desc'},{label:'评分',value:'score'},{label:'收藏',value:'favcount'}]});await picker.ready;
 const select=get(host,'picker-order').children[1];select.value='score';const pending1=select.onchange();assert.equal(all(host,'pick')[0].children[2].textContent,'#1');select.value='favcount';const pending2=select.onchange();second.resolve(ids(99,2));await pending2;first.resolve(ids(55,2));await pending1;
 assert.equal(all(host,'pick')[0].children[2].textContent,'#99');assert.equal(select.value,'favcount');assert.equal(get(host,'candidate-previews').focused,true);
});

test('翻页失败保留当前页，重试后恢复；末页不会跳到空页',async()=>{
 let fail=true;const {context}=await setup(async(tag,{page:p})=>{if(p===1)return ids(1,21);if(fail)throw Error('429');return [];});const host=new Element(),picker=context.WorkPicker.mount(host,{uid:'u',tag:'a'});await picker.ready;
 await buttons(host).next.onclick();assert.equal(get(host,'picker-page').textContent,'第 1 页');assert.equal(all(host,'pick').length,21);assert.match(get(host,'picker-message').textContent,/429/);
 fail=false;await get(host,'picker-status').children.find(n=>n.textContent==='重试').onclick();assert.equal(get(host,'picker-page').textContent,'第 1 / 1 页');assert.equal(buttons(host).next.disabled,true);
});

test('分页键只在选择器内生效，表单输入与组合键不会翻页',async()=>{
 const {context}=await setup(async(tag,{page:p})=>p===1?ids(1,21):ids(22,2));const host=new Element(),picker=context.WorkPicker.mount(host,{uid:'u',tag:'a'});await picker.ready;
 const key=(key,extra={})=>host.listeners.keydown({key,preventDefault(){},stopPropagation(){},...extra});
 key('d',{target:{closest:()=>({})}});await tick();assert.equal(get(host,'picker-page').textContent,'第 1 页');key('d',{ctrlKey:true});await tick();assert.equal(get(host,'picker-page').textContent,'第 1 页');
 key('d');await tick();assert.equal(get(host,'picker-page').textContent,'第 2 / 2 页');key('ArrowLeft');await tick();assert.equal(get(host,'picker-page').textContent,'第 1 / 2 页');key('ArrowRight');await tick();key('a');await tick();assert.equal(get(host,'picker-page').textContent,'第 1 / 2 页');
});

test('销毁后未完成请求不重建DOM，当前页旧图片绑定会及时释放',async()=>{
 const pending=gate(),disposed=[];const {context}=await setup(async(tag,{page:p})=>p===1?ids(1,21):pending.promise);context.ArtistImages.dispose=group=>disposed.push(group);
 const host=new Element(),picker=context.WorkPicker.mount(host,{uid:'u',tag:'a'});await picker.ready;const count=disposed.length;const loading=buttons(host).next.onclick();picker.dispose();pending.resolve(ids(22,2));await loading;
 assert.equal(host.children.length,0);assert.equal(disposed.length,count+1);assert.match(disposed.at(-1),/^picker:u:/);
});

test('作品编号预览与初次失败重试均保持可用',async()=>{
 let fail=true;const seen=[];const {context}=await setup(async()=>{if(fail)throw Error('读取失败');return ids(7,1);});const host=new Element(),picker=context.WorkPicker.mount(host,{uid:'u',tag:'a',onPreview:w=>seen.push(w.id)});await picker.ready;
 assert.match(get(host,'picker-message').textContent,/作品读取失败/);fail=false;await get(host,'picker-status').children.find(n=>n.textContent==='重试').onclick();all(host,'pick')[0].children[2].onclick();assert.deepEqual(seen,['7']);
});
