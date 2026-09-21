(function(root){
  'use strict';
  const $=id=>document.getElementById(id),clone=v=>structuredClone(v);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const TYPES=['image/jpeg','image/png','image/webp','image/gif','image/avif'],MAX=50*1024*1024;
  let host=null,files=[],armed=false,timer=null;
  function init(options){host=options;}
  const seqOf=uid=>ArtistId.parse(uid)?.seq??0;
  const targets=start=>host.getData().artists.map(artist=>({artist,seq:seqOf(artist.uid)})).filter(item=>item.seq>=start).sort((a,b)=>a.seq-b.seq).slice(0,files.length);
  function refresh(){
    const start=Number($('test-start').value),want=Number($('test-seq').value),preview=$('test-preview'),message=$('test-message');
    $('test-files-info').textContent=files.length?`已选择 ${files.length} 张图片。`:'还没有选择图片。';
    if(!files.length||!Number.isSafeInteger(start)||start<1){preview.replaceChildren();message.textContent='';return;}
    const list=targets(start);
    preview.replaceChildren(...list.map((item,i)=>{const row=el('div','test-row');row.append(el('span','test-seq',String(item.seq).padStart(4,'0')),el('strong','',item.artist.name),el('small','',`${files[i].name} → 序号 ${FolderStore.nextTestSeq(item.artist.works,want)}`));return row;}));
    const rest=files.length-list.length;
    message.textContent=list.length?`将依次分配给 ${list.length} 位画师${rest>0?`；后面没有更多画师，剩余 ${rest} 张会跳过`:''}。`:'这个序号之后没有画师，请检查序号。';
  }
  async function runImport(){
    if(host.getBusy()||!files.length)return;
    const start=Number($('test-start').value),want=Number($('test-seq').value),message=$('test-message');
    if(!Number.isSafeInteger(start)||start<1){message.textContent='请填写有效的起始序号。';return;}
    const list=targets(start);
    if(!list.length){message.textContent='这个序号之后没有画师，请检查序号。';return;}
    $('test-run').disabled=true;
    try{
      /* 读图与生成缩略图都很慢，先在落盘之外做完；真正写盘时改用更新函数在最新数据上合并。
         否则这段时间里别处保存过的改动，会被这份一开始克隆出来的旧快照整个盖掉。 */
      const prepared=[];
      for(let i=0;i<list.length;i++){
        const file=files[i];message.textContent=`正在处理第 ${i+1} / ${list.length} 张…`;
        if(!TYPES.includes(file.type)||file.size>MAX)throw Error(file.name+'：只支持不超过 50 MB 的 JPG、PNG、WebP、GIF 或 AVIF。');
        const original=await host.readImage(file);
        prepared.push({uid:list[i].artist.uid,original,thumb:await host.thumbnail(original)});
      }
      let done=0;
      const saved=await host.save(next=>{
        for(const item of prepared){
          const target=next.artists.find(a=>a.uid===item.uid);
          if(!target)continue;
          target.works.push({id:'',url:'',caption:'',kind:'test',testSeq:FolderStore.nextTestSeq(target.works,want),thumb:item.thumb,large:item.original,thumbUrl:null,largeUrl:null});
          done++;
        }
        return next;
      },()=>`已为 ${done} 位画师导入测试风格图片`);
      /* 写盘失败时不能报「完成」：修改只在本页里，用户必须知道，而且要指向真正能保住图片的
         办法——资料备份里不含图片，复制整个「数据」文件夹才是完整备份。 */
      if(!saved){message.textContent='没有写进磁盘：这些修改还留在本页。要保住图片请复制整个「数据」文件夹（资料备份里不含图片）。';return;}
      message.textContent=`完成：${done} 张测试风格图片已导入，各自排在作品图之后。`;
      files=[];$('test-files').value='';$('test-preview').replaceChildren();$('test-files-info').textContent='还没有选择图片。';
    }catch(error){message.textContent='导入失败：'+error.message;}
    finally{$('test-run').disabled=false;}
  }
  function renderRemoval(){
    const counts=new Map();
    for(const artist of host.getData().artists)for(const work of artist.works){
      if(work.kind!=='test')continue;
      const seq=Number.isSafeInteger(work.testSeq)&&work.testSeq>0?work.testSeq:1;
      if(!counts.has(seq))counts.set(seq,{artists:new Set(),count:0});
      const item=counts.get(seq);item.artists.add(artist.uid);item.count++;
    }
    const container=$('test-remove-list'),list=[...counts.entries()].sort((a,b)=>a[0]-b[0]);
    if(!list.length){container.replaceChildren(el('p','field-help','当前没有测试风格图片。'));return;}
    container.replaceChildren(...list.map(([seq,item])=>{
      const row=el('label','test-row'),box=el('input');box.type='checkbox';box.value=String(seq);
      row.append(box,el('span','test-seq','序号 '+seq),el('small','',`${item.artists.size} 位画师共 ${item.count} 张`));
      return row;
    }));
  }
  function disarm(){
    armed=false;clearTimeout(timer);
    const button=$('test-remove-run');button.textContent='删除所选';button.classList.remove('is-armed');
  }
  async function runRemove(){
    if(host.getBusy())return;
    const button=$('test-remove-run'),boxes=[...$('test-remove-list').querySelectorAll('input[type=checkbox]')].filter(box=>box.checked),message=$('test-message');
    if(!boxes.length){message.textContent='请先勾选要删除的测试风格序号。';return;}
    const seqs=boxes.map(box=>Number(box.value)).filter(Number.isSafeInteger);
    if(!seqs.length)return;
    if(!armed){
      armed=true;button.textContent='再次点击确认删除';button.classList.add('is-armed');
      message.textContent=`将删除所有画师中「序号 ${seqs.join('、')}」的测试风格图片，作品图不受影响。`;
      timer=setTimeout(disarm,4000);
      return;
    }
    disarm();
    const next=clone(host.getData());let removed=0;
    for(const artist of next.artists){
      const before=artist.works.length;
      artist.works=artist.works.filter(work=>!(work.kind==='test'&&seqs.includes(Number.isSafeInteger(work.testSeq)&&work.testSeq>0?work.testSeq:1)));
      removed+=before-artist.works.length;
    }
    const saved=await host.save(next,`已删除 ${removed} 张测试风格图片`);
    if(!saved){message.textContent='没有写进磁盘：这些修改还留在本页。要保住图片请复制整个「数据」文件夹（资料备份里不含图片）。';return;}
    message.textContent=`完成：删除了 ${removed} 张测试风格图片。`;
    renderRemoval();
  }
  function open(){
    files=[];$('test-files').value='';$('test-start').value='';$('test-seq').value='1';$('test-preview').replaceChildren();$('test-message').textContent='';
    refresh();renderRemoval();$('test-import').showModal();
  }
  const api={init,open,refresh,runImport,renderRemoval,runRemove,disarm,get files(){return files;},set files(list){files=list;}};
  root.ArtistTestImages=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
