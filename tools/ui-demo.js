/* 仅预览服务器 / 浏览器回归注入；不进入单文件及扩展构建。所有资料均为虚构演示。 */
(() => {
 async function seed(count=24){
  const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('演示资料库',{create:true});
  const palettes=[['#c1d6ce','#70988b','#345b52','#efd9a8'],['#dad1bc','#a79679','#665e55','#f6e6be'],['#bacbd8','#7e97b4','#485c81','#ded3b2'],['#e6bfad','#bd8b82','#715c69','#f5d79f'],['#cbd6b9','#8da881','#526e61','#f8eac7']];
  const thumbnails=palettes.map((p,index)=>{const c=document.createElement('canvas');c.width=280;c.height=360;const x=c.getContext('2d');x.fillStyle=p[0];x.fillRect(0,0,280,360);x.fillStyle=p[3];x.beginPath();x.arc(186-index*13,85,36,0,Math.PI*2);x.fill();for(let layer=0;layer<3;layer++){x.fillStyle=p[Math.min(layer+1,2)];x.globalAlpha=.52+layer*.18;x.beginPath();x.moveTo(0,210+layer*45);for(let n=0;n<8;n++)x.lineTo(n*45,160+layer*60+Math.sin(n*1.3+index+layer)*40);x.lineTo(280,360);x.lineTo(0,360);x.fill();}x.globalAlpha=.65;x.strokeStyle=p[3];x.lineWidth=3;x.beginPath();x.moveTo(135,360);x.bezierCurveTo(230,270,65,300,158,245);x.stroke();x.globalAlpha=1;return c.toDataURL('image/jpeg',.82);});
  const names=['sora_field','mizu_no_oto','森间来信','atelier_north','rin_scenery','小岛日记'],categories=['场景 / 环境','二次元','概念 / 设定'],tags=['自然光','安静','色彩研究','叙事感','清爽','建筑'];
  const data=FolderStore.empty();data.categories=categories;data.tags=tags;data.fixedTestSlots=true;
  data.artists=Array.from({length:count},(_,i)=>({uid:String(i+1).padStart(4,'0')+'-demo'+i+'-manual',name:names[i%names.length]+(i>=names.length?'_'+(i+1):''),order:i+1,category:categories[i%3],score:5-i%5,alias:i===0?'空野':i===1?'水之声':null,aliases:i===0?['空野','sky painter']:[],tags:[tags[i%tags.length],tags[(i+1)%tags.length]],description:['温柔的自然光与克制的色彩，记录安静的日常风景。','重视明暗节奏与空间层次，适合构图和色彩参考。','以柔和笔触描绘环境，画面保留自然的呼吸感。'][i%3],note:i===0?'春日旅行参考 · 绿色调与远景层次':'',counts:{total:1800-i*17,beforeTotal:1200-i*13,beforeDate:'2026-07-01'},artistUrl:'https://example.com/demo-artist',works:Array.from({length:5},(_,j)=>({id:j<3?String(10000+i*5+j):'',caption:'演示风景 · 非画师真实作品',thumb:thumbnails[(i+j)%5],large:thumbnails[(i+j)%5],...(j>=3?{kind:'test',testSeq:5-j}:{})}))}));
  await FolderStore.write(folder,data);window.showDirectoryPicker=async()=>folder;await document.getElementById('choose-folder').onclick();
  return {folder,data,thumbnails};
 }
 window.ArtistDemo={seed};
 if(new URLSearchParams(location.search).get('demo')==='1'){
  // 演示始终使用独立 OPFS。联网、采集和付费生成不会发往真实服务。
  window.fetch=async()=>{throw Error('演示模式不发送网络请求');};ArtistLookup.lookup=async()=>[];ArtistLookup.posts=async()=>[];ArtistLookup.details=async()=>({counts:{}});ArtistImageGen.generate=async()=>{throw Error('演示模式不生成图片');};
  seed().then(()=>{const node=document.getElementById('storage-status');node.textContent='演示资料 · 画师与图片均为虚构；不连接真实数据文件夹';window.ArtistWorkspace.status(node.textContent,false);}).catch(error=>{document.getElementById('storage-status').textContent='演示加载失败：'+error.message;});
 }
})();
