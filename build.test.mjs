import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from './build.mjs';
test('画师库.html 与 app/ 源码保持同步',async()=>{
  const actual=await fs.readFile(new URL('画师库.html',import.meta.url),'utf8'),built=await build();
  if(built!==actual){
    let i=0;while(i<built.length&&i<actual.length&&built[i]===actual[i])i++;
    assert.fail('画师库.html 与 app/ 源码不一致：首个差异在第 '+i+' 个字符（磁盘 '+actual.length+' 字符 / 重建 '+built.length+' 字符）。请运行 npm run build 重新生成。');
  }
  assert.ok(actual.includes('<style>')&&actual.includes('ArtistGallery'),'单文件网页应内联样式与脚本');
  assert.ok(!/<script src="[^"]+" defer><\/script>/.test(actual),'单文件网页不应保留外部 script 引用');
});
