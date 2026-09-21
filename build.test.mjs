import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build,mirrorApp,MIRROR_DIR} from './build.mjs';
test('画师库.html 与 app/ 源码保持同步',async()=>{
  const actual=await fs.readFile(new URL('画师库.html',import.meta.url),'utf8'),built=await build();
  if(built!==actual){
    let i=0;while(i<built.length&&i<actual.length&&built[i]===actual[i])i++;
    assert.fail('画师库.html 与 app/ 源码不一致：首个差异在第 '+i+' 个字符（磁盘 '+actual.length+' 字符 / 重建 '+built.length+' 字符）。请运行 npm run build 重新生成。');
  }
  assert.ok(actual.includes('<style>')&&actual.includes('ArtistGallery'),'单文件网页应内联样式与脚本');
  assert.ok(!/<script src="[^"]+" defer><\/script>/.test(actual),'单文件网页不应保留外部 script 引用');
});
test('扩展里的画师库镜像与 app/ 源码逐字节一致',async()=>{
  const files=await mirrorApp();
  for(const [name,content] of Object.entries(files)){
    /* 必须按字节比。以前两边都按 utf8 读再比字符串，于是「一起坏」也会「一起相等」——
       镜像里的 PNG 被替换字符撑大过（32975 → 60515 字节），页头图标因此显示不出来，测试却是绿的。 */
    const onDisk=await fs.readFile(new URL(MIRROR_DIR+name,import.meta.url)).catch(()=>null);
    assert.notEqual(onDisk,null,'扩展里缺少 '+MIRROR_DIR+name+'：跑一次 npm run build');
    const expected=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8');
    assert.ok(onDisk.equals(expected),MIRROR_DIR+name+' 与 app/'+name+' 不一致：跑一次 npm run build');
  }
  assert.ok(Buffer.isBuffer(files['icon.png'])&&files['icon.png'].length>1000,'图标是二进制，必须按 Buffer 搬运，不能走 utf8 文本处理');
  assert.ok(files['host-direct.js'].includes('ArtistHostDirect'),'直连实现必须在镜像里');
  assert.match(files['index.html'],/<script src="host-direct\.js" defer><\/script>\s*<script src="extension-bridge\.js" defer>/,'直连实现要排在桥前面');
  assert.equal(files['index.html'].includes('<script>'),false,'扩展页禁止内联脚本，镜像必须是外链脚本那一份');
});
