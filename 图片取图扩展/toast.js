(() => {
  'use strict';
  /* 漂浮提示：右键菜单添加画师的结果，画在用户当前所在页面的右上角。
     两个踩过的坑，别再犯：
     1) 定位必须写在 all:initial 之后——同一串声明里 all:initial 放最后会把 position/top/right 全抹掉，
        提示就变成页面尾部一个静态块，等于看不见；
     2) 样式一律用 CSSOM 赋值，不插 <style>：严格 CSP 的站点（style-src 不带 unsafe-inline）会屏蔽
        注入的 <style> 与 style 属性，而 element.style.xxx=… 这种写法不受页面 CSP 影响。
     用 Shadow DOM 隔离，绝不碰宿主页面的任何东西。 */
  const HOST_ID='artist-library-toast-host';
  let timer=null;
  const style=(node,rules)=>{for(const [name,value] of Object.entries(rules)){if(name==='setProperty')continue;try{node.style[name]=value;}catch{}}return node;};
  const HOST_RULES={all:'initial',position:'fixed',top:'18px',right:'18px','z-index':'2147483647',display:'block'};
  const BOX_RULES={font:'13px/1.6 system-ui,"Microsoft YaHei",sans-serif',color:'#26292f',borderRadius:'10px',padding:'12px 14px',maxWidth:'340px',minWidth:'180px',cursor:'pointer',boxShadow:'0 10px 30px rgba(0,0,0,.15)',transition:'opacity .2s ease-out',opacity:'0'};
  const TITLE_RULES={display:'block',fontSize:'14px',marginBottom:'4px'};
  const DETAIL_RULES={margin:'0',color:'#5b6270',wordBreak:'break-word'};
  const HINT_RULES={display:'block',marginTop:'6px',color:'#8b93a1',fontSize:'11px'};
  const render=payload=>{
    document.getElementById(HOST_ID)?.remove();
    clearTimeout(timer);
    const ok=payload?.ok===true,accent=ok?'#177a4b':'#c0392b';
    const host=document.createElement('div');
    host.id=HOST_ID;
    style(host,HOST_RULES);
    const root=host.attachShadow?host.attachShadow({mode:'open'}):host;
    const box=document.createElement('div');
    style(box,{...BOX_RULES,background:ok?'#f2fbf6':'#fdf3f2',border:'1px solid '+accent+'55',borderLeft:'4px solid '+accent});
    box.setAttribute('role','status');
    box.title='点击进入画师库';
    const title=document.createElement(ok?'strong':'strong');
    style(title,{...TITLE_RULES,color:accent});
    title.textContent=ok?`已添加「${payload?.name||''}」`:'没能添加画师';
    const detail=document.createElement('p');
    style(detail,DETAIL_RULES);
    detail.textContent=ok
      ?[payload?.danbooruId?('Danbooru #'+payload.danbooruId):'',payload?.works?`${payload.works} 张作品`:''].filter(Boolean).join(' · ')
      :String(payload?.reason||'未知原因');
    const hint=document.createElement('small');
    style(hint,HINT_RULES);
    hint.textContent='点击进入画师库并定位';
    box.append(title,detail,hint);
    box.addEventListener('click',()=>{
      try{chrome.runtime.sendMessage({type:'artist-library.toast-click',uid:payload?.uid||'',text:payload?.text||'',ok});}catch{}
      host.remove();
    });
    root.append(box);
    (document.body||document.documentElement).append(host);
    /* 下一帧再把不透明度提上来，做出淡入；不依赖 @keyframes，CSP 也管不到。 */
    (typeof requestAnimationFrame==='function'?requestAnimationFrame:fn=>setTimeout(fn,16))(()=>{box.style.opacity='1';});
    timer=setTimeout(()=>host.remove(),9000);
  };
  try{chrome.runtime.onMessage.addListener(message=>{if(message?.type==='artist-library.toast')render(message.payload);});}catch{}
})();
