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
  let timer=null,pulse=null;
  const style=(node,rules)=>{for(const [name,value] of Object.entries(rules)){if(name==='setProperty')continue;try{node.style[name]=value;}catch{}}return node;};
  const HOST_RULES={all:'initial',position:'fixed',top:'18px',right:'18px','z-index':'2147483647',display:'block'};
  const BOX_RULES={font:'13px/1.6 system-ui,"Microsoft YaHei",sans-serif',color:'#26292f',borderRadius:'10px',padding:'12px 14px',maxWidth:'340px',minWidth:'180px',cursor:'pointer',boxShadow:'0 10px 30px rgba(0,0,0,.15)',transition:'opacity .2s ease-out',opacity:'0'};
  const TITLE_RULES={display:'block',fontSize:'14px',marginBottom:'4px'};
  const DETAIL_RULES={margin:'0',color:'#5b6270',wordBreak:'break-word'};
  const HINT_RULES={display:'block',marginTop:'6px',color:'#8b93a1',fontSize:'11px'};
  /* 三种状态：正在尝试（琥珀）/ 已排队（蓝，等画师库打开）/ 结果（绿或红）。 */
  const look=payload=>{
    if(payload?.state==='pending')return {accent:'#b8791a',background:'#fdf7ee',title:'正在尝试加入画师库…',hint:'正在查询 Danbooru，请稍候',dot:true};
    if(payload?.state==='queued')return {accent:'#3b5bdb',background:'#f2f5fd',title:'已记下这次添加',hint:'点击打开画师库，打开时自动添加',dot:false};
    /* 认不出画师时也建了卡，只是资料待补：用琥珀色和「已排队」的蓝、「已完成」的绿区分开。 */
    if(payload?.ok===true&&payload?.partial)return {accent:'#b8791a',background:'#fdf7ee',title:`已收下「${payload?.name||''}」`,hint:'没认出画师，资料待你补全；点击进入画师库',dot:false};
    if(payload?.ok===true)return {accent:'#177a4b',background:'#f2fbf6',title:`已添加「${payload?.name||''}」`,hint:'点击进入画师库并定位',dot:false};
    return {accent:'#c0392b',background:'#fdf3f2',title:'没能添加画师',hint:'点击进入画师库手动添加',dot:false};
  };
  const detailOf=(payload,ok)=>{
    if(payload?.state)return String(payload?.text||'');
    if(ok)return [payload?.partial?String(payload?.text||''):'',payload?.danbooruId?('Danbooru #'+payload.danbooruId):'',payload?.works?`${payload.works} 张作品`:''].filter(Boolean).join(' · ');
    return String(payload?.reason||'未知原因');
  };
  const render=payload=>{
    document.getElementById(HOST_ID)?.remove();
    clearTimeout(timer);clearInterval(pulse);pulse=null;
    const ok=payload?.ok===true,skin=look(payload);
    const host=document.createElement('div');
    host.id=HOST_ID;
    style(host,HOST_RULES);
    const root=host.attachShadow?host.attachShadow({mode:'open'}):host;
    const box=document.createElement('div');
    style(box,{...BOX_RULES,background:skin.background,border:'1px solid '+skin.accent+'55',borderLeft:'4px solid '+skin.accent});
    box.setAttribute('role','status');
    box.title=skin.hint;
    const title=document.createElement('strong');
    style(title,{...TITLE_RULES,color:skin.accent});
    title.textContent=skin.title;
    const detail=document.createElement('p');
    style(detail,DETAIL_RULES);
    detail.textContent=detailOf(payload,ok);
    const hint=document.createElement('small');
    style(hint,HINT_RULES);
    hint.textContent=skin.hint;
    box.append(title,detail,hint);
    box.addEventListener('click',()=>{
      try{chrome.runtime.sendMessage({type:'artist-library.toast-click',uid:payload?.uid||'',text:payload?.text||'',ok});}catch{}
      host.remove();
    });
    root.append(box);
    (document.body||document.documentElement).append(host);
    /* 下一帧再把不透明度提上来，做出淡入；不依赖 @keyframes，CSP 也管不到。 */
    (typeof requestAnimationFrame==='function'?requestAnimationFrame:fn=>setTimeout(fn,16))(()=>{box.style.opacity='1';});
    /* 「正在尝试」阶段闪一个小圆点，让等待看得出还在动。 */
    if(skin.dot){
      const mark=document.createElement('span');
      style(mark,{display:'inline-block',marginLeft:'6px',color:skin.accent});
      mark.textContent='●';
      hint.append(mark);
      let on=true;
      pulse=setInterval(()=>{on=!on;mark.style.opacity=on?'1':'0.25';},420);
    }
    timer=setTimeout(()=>{clearInterval(pulse);host.remove();},payload?.state==='pending'?30000:9000);
  };
  try{chrome.runtime.onMessage.addListener(message=>{if(message?.type==='artist-library.toast')render(message.payload);});}catch{}
})();
