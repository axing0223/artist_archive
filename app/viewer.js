(function(root){
  'use strict';
  const $=id=>document.getElementById(id),clone=v=>structuredClone(v);
  let host=null,current=null;
  function init(options){host=options;}
  function dispose(){current=null;}
  function open({title,uid,work,caption,persist=false}){
    current={uid,work,persist};
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
    const {uid,work}=current;
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
      const saved=await keepLarge(uid,work,blob,remote);
      if(saved&&current&&current.uid===uid)current.work=saved;
    }catch(error){host.notify('保存原图失败：'+error.message,true);}
    finally{refreshButton();}
  }
  async function loadLarge(uid,work,caption,persist){
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
      if(persist&&host.getData().saveLargeImages&&host.getFolder()&&remote&&!local){
        kept=await keepLarge(uid,work,blob,remote);
        if(kept&&current&&current.uid===uid)current.work=kept;
        refreshButton();
      }
      if(!$('viewer').open)return;
      img.onload=()=>{$('viewer-caption').textContent=note+(kept?'原图已保存到本地':'原图仅本次显示，不会保存到本地');};
      ArtistImages.bind(img,uid,target,'viewer','large',error=>showMiddle(uid,work,caption,error));
    }catch(error){if(error.name!=='AbortError')showMiddle(uid,work,caption,error);}
  }
  async function keepLarge(uid,work,blob,remote){
    try{
      const path=await FolderStore.saveImage(host.getFolder(),uid,'large',blob);
      const next=clone(host.getData()),target=next.artists.find(x=>x.uid===uid),index=target?target.works.findIndex(x=>x.id===work.id):-1;
      if(index<0)return null;
      target.works[index]={...target.works[index],large:path,largeUrl:remote||work.largeUrl||null};
      await host.save(next,'原图已保存到本地，之后预览直接读本地');
      return target.works[index];
    }catch(error){host.notify('原图保存失败：'+error.message,true);return null;}
  }
  function showMiddle(uid,work,caption,error){
    const note=caption?caption+' · ':'',middle=work.previewUrl;
    if(!middle||middle===work.largeUrl){$('viewer-caption').textContent=note+'原图未取到：'+error.message+'（显示的是缩略图）';return;}
    $('viewer-caption').textContent=note+'原图未取到：'+error.message+'，改用中图显示';
    ArtistImages.bind($('large-image'),uid,{...work,largeUrl:middle},'viewer','large',e2=>{$('viewer-caption').textContent=note+'中图也未取到：'+e2.message+'（显示的是缩略图）';});
  }
  const api={init,dispose,open,saveOriginal,refreshButton};
  root.ArtistViewer=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
