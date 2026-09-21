(function(root){
  'use strict';
  const $=id=>document.getElementById(id),clone=v=>structuredClone(v);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const TYPES=['image/jpeg','image/png','image/webp','image/gif','image/avif'],MAX=50*1024*1024;
  let host=null,files=[],armed=false,timer=null,running=false;
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
    if(running||host.getBusy()||!files.length)return;
    const start=Number($('test-start').value),want=Number($('test-seq').value),message=$('test-message');
    if(!Number.isSafeInteger(start)||start<1){message.textContent='请填写有效的起始序号。';return;}
    const list=targets(start);
    if(!list.length){message.textContent='这个序号之后没有画师，请检查序号。';return;}
    const selected=files.slice(),controls=['test-run','test-files','test-start','test-seq'].map(id=>[$(id),$(id).disabled]);
    running=true;host.setImportRunning?.(true);controls.forEach(([node])=>node.disabled=true);
    let done=0,completed=0,prepared=[],bytes=0;
    const keepRemaining=()=>{
      files=selected.slice(completed,list.length);
      if(list[completed])$('test-start').value=String(list[completed].seq);
      refresh();
    };
    const flush=async()=>{
      if(!prepared.length)return true;
      const batch=prepared;prepared=[];bytes=0;let added=0,applied=false;
      const saved=await host.save(next=>{
        applied=true;
        const byId=new Map(next.artists.map(a=>[a.uid,a]));
        for(const item of batch){
          const target=byId.get(item.uid);
          if(!target)continue;
          target.works.push({id:'',url:'',caption:'',kind:'test',testSeq:FolderStore.nextTestSeq(target.works,want),thumb:item.thumb,large:item.original,thumbUrl:null,largeUrl:null});
          added++;
        }
        return next;
      },()=>`已为 ${done+added} 位画师导入测试风格图片`);
      if(!saved){
        // 更新函数已经应用到内存的图片不能再次追加，否则重试会生成重复测试图。
        if(applied)completed+=batch.length;
        keepRemaining();message.textContent=`本批没有写进磁盘；前面已保存 ${done} 张。本批修改暂留本页，尚未保存。完整图片备份请复制「数据」文件夹。`;return false;
      }
      done+=added;completed+=batch.length;return true;
    };
    try{
      // 每批最多 10 张或约 32 MiB 的图片字符串；单张大图允许独占一批。
      // 先验证文件属性，解码失败则保留前面已经提交的批次，并从未提交的位置续选。
      for(const file of selected.slice(0,list.length))if(!TYPES.includes(file.type)||file.size>MAX)throw Error(file.name+'：只支持不超过 50 MB 的 JPG、PNG、WebP、GIF 或 AVIF。');
      for(let i=0;i<list.length;i++){
        const file=selected[i];
        if(prepared.length&&bytes+file.size*8/3>32*1024*1024&&!await flush())return;
        message.textContent=`已保存 ${done} 张，正在处理第 ${i+1} / ${list.length} 张…`;
        const original=await host.readImage(file);
        const thumb=await host.thumbnail(original);
        prepared.push({uid:list[i].artist.uid,original,thumb});bytes+=(original.length+thumb.length)*2;
        if((prepared.length>=10||bytes>=32*1024*1024)&&!await flush())return;
      }
      if(!await flush())return;
      message.textContent=`完成：${done} 张测试风格图片已导入，各自排在作品图之后。`;
      files=[];$('test-files').value='';$('test-preview').replaceChildren();$('test-files-info').textContent='还没有选择图片。';
    }catch(error){
      keepRemaining();message.textContent=`导入失败：${error.message}；前面已保存 ${done} 张，剩余图片可修正后继续。`;
    }
    finally{prepared=[];running=false;host.setImportRunning?.(false);controls.forEach(([node,disabled])=>node.disabled=disabled);}
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
    if(running){$('test-import').showModal();return;}
    files=[];$('test-files').value='';$('test-start').value='';$('test-seq').value='1';$('test-preview').replaceChildren();$('test-message').textContent='';
    refresh();renderRemoval();$('test-import').showModal();
  }
  const api={init,open,refresh,runImport,renderRemoval,runRemove,disarm,get files(){return files;},set files(list){if(!running)files=list;}};
  root.ArtistTestImages=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
