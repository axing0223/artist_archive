import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=new URL('./',import.meta.url);
// 统一行尾为 LF：源文件行尾不一致时，产物字节仍保持稳定，构建结果可复现。
const text=async path=>(await fs.readFile(new URL(path,root),'utf8')).replace(/\r\n/g,'\n');
const scripts=['artist-id.js','artist-lookup.js','folder-store.js','extension-bridge.js','host-direct.js','novelai.js','image-gen.js','generate-queue.js','image-cache.js','image-loader.js','virtual-gallery.js','work-picker.js','viewer.js','test-images.js','app.js'];
/* 扩展页要跑画师库：MV3 的扩展页禁止内联脚本，所以扩展里放的必须是多文件那一份（app/ 原样镜像），
   单文件的 画师库.html 只给 file:// 双击用。镜像由构建生成，不再手工维护第二份源码。 */
const mirror=['index.html','style.css','favicon.svg',...scripts];
export const MIRROR_DIR='图片取图扩展/app/';
export async function build(){
  const css=await text('app/style.css'),favicon=(await fs.readFile(new URL('app/favicon.svg',root))).toString('base64');
  let html=(await text('app/index.html'))
    .replace(/<script src="[^"]+" defer><\/script>/g,'')
    .replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+css+'</style>')
    .replace('href="favicon.svg"','href="data:image/svg+xml;base64,'+favicon+'"');
  let inline='';for(const file of scripts)inline+='<script>'+await text('app/'+file)+'</script>';
  return html.replace('</body>',()=>inline+'</body>');
}
/* 镜像进扩展目录：文件内容与 app/ 逐字节一致（只统一行尾），扩展页照原样引用相对路径。 */
export async function mirrorApp(){
  const files={};
  for(const name of mirror)files[name]=await text('app/'+name);
  return files;
}
async function writeMirror(files){
  await fs.mkdir(new URL(MIRROR_DIR,root),{recursive:true});
  for(const [name,content] of Object.entries(files))await fs.writeFile(new URL(MIRROR_DIR+name,root),content);
  const stale=await fs.readdir(new URL(MIRROR_DIR,root));
  for(const name of stale)if(!mirror.includes(name))await fs.rm(new URL(MIRROR_DIR+name,root),{force:true});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await fs.writeFile(new URL('画师库.html',root),await build());
  const files=await mirrorApp();
  await writeMirror(files);
  console.log('已重新生成 画师库.html');
  console.log('已同步扩展内的画师库：'+MIRROR_DIR+'（'+mirror.length+' 个文件）');
}
