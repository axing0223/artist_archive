import {test} from 'node:test';import assert from 'node:assert/strict';
import {pickPromptTag,normalizePromptTag,promptTagAt} from './图片取图扩展/prompt-tag.mjs';
test('双击落点摘出的是整段提示词，而不是被空格截断的那个词',()=>{
  /* 浏览器原生双击 long hair 只会给到 long，这正是不能直接用 getSelection() 的原因。 */
  assert.equal(pickPromptTag('1girl, long hair, solo',7),' long hair');
  assert.equal(promptTagAt('1girl, long hair, solo',7),'long_hair');
});
test('分隔符认全角逗号、分号、竖线与换行',()=>{
  assert.equal(promptTagAt('1girl，long hair；solo|smile',10),'long_hair');
  assert.equal(promptTagAt('1girl\nlong hair\nsolo',10),'long_hair');
});
test('落点在开头、结尾、以及正好落在分隔符上都不越界',()=>{
  assert.equal(promptTagAt('solo',0),'solo');
  assert.equal(promptTagAt('solo',4),'solo');
  assert.equal(promptTagAt('',0),'');
  assert.equal(promptTagAt('a, b',1),'a');
  /* 逗号后面的空格不是分隔符，所以从逗号处取到的是后一个标签；只有空白则规整成空串。 */
  assert.equal(promptTagAt('a, b',2),'b');
  assert.equal(promptTagAt('a,   ',2),'');
});
test('内部空白收成下划线，两头的空白与残留分隔符去掉',()=>{
  assert.equal(normalizePromptTag('  long   hair '),'long_hair');
  assert.equal(normalizePromptTag(' long　hair '),'long_hair');
  assert.equal(normalizePromptTag('long hair,'),'long_hair');
});
test('权重写法只取标签本身：搜索要的是标签，不是权重',()=>{
  assert.equal(normalizePromptTag('(long hair:1.2)'),'long_hair');
  assert.equal(normalizePromptTag('[long hair]'),'long_hair');
  assert.equal(normalizePromptTag('{long hair}'),'long_hair');
  assert.equal(normalizePromptTag('long hair:1.2'),'long_hair');
});
test('已经是下划线写法的原样通过',()=>{
  assert.equal(promptTagAt('1girl, long_hair, solo',7),'long_hair');
});
