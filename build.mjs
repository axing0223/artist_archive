import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=new URL('./',import.meta.url);
// 统一行尾为 LF：源文件行尾不一致时，产物字节仍保持稳定，构建结果可复现。
const text=async path=>(await fs.readFile(new URL(path,root),'utf8')).replace(/\r\n/g,'\n');
const scripts=['artist-id.js','artist-lookup.js','folder-store.js','extension-bridge.js','novelai.js','image-gen.js','image-cache.js','image-loader.js','virtual-gallery.js','work-picker.js','viewer.js','test-images.js','app.js'];
export async function build(){
  const css=await text('app/style.css'),favicon=(await fs.readFile(new URL('app/favicon.svg',root))).toString('base64');
  let html=(await text('app/index.html'))
    .replace(/<script src="[^"]+" defer><\/script>/g,'')
    .replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+css+'</style>')
    .replace('href="favicon.svg"','href="data:image/svg+xml;base64,'+favicon+'"');
  let inline='';for(const file of scripts)inline+='<script>'+await text('app/'+file)+'</script>';
  return html.replace('</body>',()=>inline+'</body>');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await fs.writeFile(new URL('画师库.html',root),await build());
  console.log('已重新生成 画师库.html');
}
