(() => {
  'use strict';
  /* 漂浮提示：右键菜单添加画师的结果，画在用户当前所在页面的右上角。
     只在收到扩展消息时动手，点一下就把结果交回后台（成功→定位到新卡片，失败→把文字送进识别框）。
     用 Shadow DOM 隔离样式，绝不碰宿主页面的任何东西。 */
  const HOST_ID='artist-library-toast-host';
  let timer=null;
  const render=payload=>{
    document.getElementById(HOST_ID)?.remove();
    clearTimeout(timer);
    const host=document.createElement('div');
    host.id=HOST_ID;
    host.style.cssText='position:fixed;top:18px;right:18px;z-index:2147483647;all:initial';
    const shadow=host.attachShadow({mode:'open'});
    const ok=payload?.ok===true;
    const accent=ok?'#177a4b':'#c0392b',background=ok?'#f2fbf6':'#fdf3f2';
    const title=ok?`已添加「${payload.name||''}」`:'没能添加画师';
    const detail=ok
      ?[payload.danbooruId?('Danbooru #'+payload.danbooruId):'',payload.works?`${payload.works} 张作品`:''].filter(Boolean).join(' · ')
      :String(payload?.reason||'未知原因');
    shadow.innerHTML=`<style>
      .box{font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:#26292f;background:${background};border:1px solid ${accent}55;border-left:4px solid ${accent};border-radius:10px;box-shadow:0 10px 30px #00000026;padding:12px 14px;max-width:340px;cursor:pointer;animation:slide .22s ease-out}
      .box:hover{box-shadow:0 12px 34px #00000033}
      strong{display:block;font-size:14px;color:${accent};margin-bottom:4px}
      p{margin:0;color:#5b6270;word-break:break-word}
      small{display:block;margin-top:6px;color:#8b93a1;font-size:11px}
      @keyframes slide{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
    </style>
    <div class="box" role="status" title="点击进入画师库">
      <strong></strong><p></p><small>点击进入画师库并定位</small>
    </div>`;
    shadow.querySelector('strong').textContent=title;
    shadow.querySelector('p').textContent=detail;
    shadow.querySelector('.box').addEventListener('click',()=>{
      try{chrome.runtime.sendMessage({type:'artist-library.toast-click',uid:payload?.uid||'',text:payload?.text||'',ok});}catch{}
      host.remove();
    });
    (document.body||document.documentElement).append(host);
    timer=setTimeout(()=>host.remove(),9000);
  };
  try{chrome.runtime.onMessage.addListener(message=>{if(message?.type==='artist-library.toast')render(message.payload);});}catch{}
})();
