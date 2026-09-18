(function(root){
  'use strict';
  const MAX=100,NAME_MAX=60,DEFAULT_NAME='artist';
  const clean=value=>{
    const text=String(value??'').normalize('NFC').trim().replace(/[^\p{L}\p{N}_-]+/gu,'_').replace(/_{2,}/g,'_').replace(/^[_-]+|[_-]+$/g,'');
    return (text||DEFAULT_NAME).slice(0,NAME_MAX);
  };
  const pad=seq=>String(seq).padStart(4,'0');
  const tail=danbooruId=>Number.isSafeInteger(danbooruId)&&danbooruId>0?String(danbooruId):'manual';
  function create({seq,name,danbooruId}={}){
    const n=Number(seq);
    if(!Number.isSafeInteger(n)||n<1)throw Error('序号必须是正整数');
    const uid=pad(n)+'-'+clean(name)+'-'+tail(danbooruId);
    if(uid.length>MAX)throw Error('画师标识过长：'+uid.length+' 个字符');
    return uid;
  }
  function parse(uid){
    const m=/^(\d{1,9})-(.+)-([0-9]{1,12}|manual)$/.exec(String(uid??''));
    if(!m)return null;
    return {seq:Number(m[1]),name:m[2],danbooruId:m[3]==='manual'?null:Number(m[3])};
  }
  function valid(uid){const s=String(uid??'');return s.length>=1&&s.length<=MAX&&/^[\p{L}\p{N}_-]+$/u.test(s);}
  function nextSeq(uids){let max=0;for(const uid of uids||[]){const p=parse(uid);if(p&&p.seq>max)max=p.seq;}return max+1;}
  function issue(artists,{name,danbooruId}={}){return create({seq:nextSeq((artists||[]).map(a=>a&&a.uid)),name,danbooruId});}
  const api={create,parse,valid,nextSeq,issue,clean,MAX,NAME_MAX};
  root.ArtistId=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
