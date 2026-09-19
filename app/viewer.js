(function(root){
  'use strict';
  const $=id=>document.getElementById(id);
  let host=null,current=null;
  function init(options){
    host=options;$('viewer-prev').onclick=()=>step(-1);$('viewer-next').onclick=()=>step(1);
    $('viewer').addEventListener?.('keydown',event=>{if(event.isComposing||event.target?.matches?.('input,textarea,select'))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();step(event.key==='ArrowLeft'?-1:1);}});
  }
  function step(delta){
    if(!current?.items||current.items.length<2)return;
    const next=(current.position+delta+current.items.length)%current.items.length,work=current.items[next];
    open({...current,work,caption:work.caption});
  }
  function dispose(){current=null;}
  function open({title,uid,work,caption,persist=false,items=null}){
    const position=items?items.indexOf(work):-1;
    current={title,uid,work,persist,items,position,folder:host.getFolder()};
    $('viewer-navigation').hidden=position<0||items.length<2;
    $('viewer-position').textContent=position>=0?(position+1)+' / '+items.length:'';
    ArtistImages.dispose('viewer');
    $('viewer-title').textContent=title;$('large-image').alt=title;
    $('viewer-caption').textContent='正在获取原图…';
    $('viewer-source').hidden=!work.url;if(work.url)$('viewer-source').href=work.url;
    refreshButton();
    $('viewer').showModal();
    ArtistImages.bind($('large-image'),uid,work,'viewer','thumb',()=>{});
    loadLarge(uid,work,caption,persist);
  }
  function refreshButton(saving=false){
    const button=$('save-original'),folder=host.getFolder();
    if(!current||!current.persist||!folder){button.hidden=true;return;}
    const local=FolderStore.imageOf(current.work,'large')?.kind==='local';
    button.hidden=false;button.disabled=local||saving;
    button.textContent=local?'原图已保存':saving?'正在保存…':'保存原图';
  }
  async function saveOriginal(){
    if(!current||!current.persist||!host.getFolder())return;
    const request=current,{uid,work,folder}=request;
    refreshButton(true);
    try{
      const local=FolderStore.imageOf(work,'large');
      let target=work,remote=null;
      if(!local||local.kind==='remote'){
        remote=work.largeUrl||(work.id&&ArtistExtension.connected?await ArtistExtension.resolve(work.id):null);
        if(!remote)throw Error('这张作品没有原图地址');
        target={...work,largeUrl:remote};
      }
      const blob=await ArtistImages.fetch(uid,target,'large');
      const saved=await keepLarge(uid,work,blob,remote,folder);
      if(saved&&current===request)current.work=saved;
    }catch(error){host.notify('保存原图失败：'+error.message,true);}
    finally{refreshButton();}
  }
  async function loadLarge(uid,work,caption,persist){
    const request=current,folder=request.folder;
    const img=$('large-image'),note=caption?caption+' · ':'',local=FolderStore.imageOf(work,'large');
    $('viewer-caption').textContent=note+'正在获取原图…';
    try{
      let target=work,remote=null,kept=null;
      if(!local||local.kind==='remote'){
        remote=work.largeUrl||(work.id&&ArtistExtension.connected?await ArtistExtension.resolve(work.id):null);
        if(!remote)throw Error('这张作品没有原图地址');
        target={...work,largeUrl:remote};
      }
      const blob=await ArtistImages.fetch(uid,target,'large');
      if(current!==request)return;
      if(persist&&host.getData().saveLargeImages&&host.getFolder()&&remote&&local?.kind!=='local'){
        kept=await keepLarge(uid,work,blob,remote,folder);
        if(kept&&current===request)current.work=kept;
        refreshButton();
      }
      if(current!==request||!$('viewer').open)return;
      img.onload=()=>{$('viewer-caption').textContent=note+(kept?'原图已保存到本地':local?.kind==='local'?'正在查看本地原图':local?.kind==='inline'?'正在查看库内图片':'原图仅本次显示，不会保存到本地');};
      ArtistImages.bind(img,uid,target,'viewer','large',error=>showMiddle(uid,work,caption,error));
    }catch(error){if(current===request&&error.name!=='AbortError')showMiddle(uid,work,caption,error);}
  }
  async function keepLarge(uid,work,blob,remote,folder){
    try{
      if(folder!==host.getFolder())throw Error('数据文件夹已经切换，未保存旧预览的图片');
      const path=await FolderStore.saveImage(folder,uid,'large',blob);
      let saved;
      const ok=await host.save(next=>{
        if(folder!==host.getFolder())throw Error('数据文件夹已经切换，未写入旧预览');
        const target=next.artists.find(x=>x.uid===uid),index=target?target.works.findIndex(x=>work.id?x.id===work.id:x.thumb===work.thumb&&x.kind===work.kind&&x.testSeq===work.testSeq):-1;
        if(index<0)throw Error('这张作品已经移除，未修改画师资料');
        saved=target.works[index]={...target.works[index],large:path,largeUrl:remote||work.largeUrl||null};
        return next;
      },'原图已保存到本地，之后预览直接读本地');
      return ok===false?null:saved;
    }catch(error){host.notify('原图保存失败：'+error.message,true);return null;}
  }
  function showMiddle(uid,work,caption,error){
    const note=caption?caption+' · ':'',middle=work.previewUrl;
    if(!middle||middle===work.largeUrl){$('viewer-caption').textContent=note+'原图未取到：'+error.message+'（显示的是缩略图）';return;}
    $('viewer-caption').textContent=note+'原图未取到：'+error.message+'，改用中图显示';
    ArtistImages.bind($('large-image'),uid,{...work,largeUrl:middle},'viewer','large',e2=>{$('viewer-caption').textContent=note+'中图也未取到：'+e2.message+'（显示的是缩略图）';});
  }
  const api={init,dispose,open,step,saveOriginal,refreshButton};
  root.ArtistViewer=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
