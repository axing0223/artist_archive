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
test('前后换行只是边界，不该混进标签里',()=>{
  /* takoma 里提示词是按行排的，回车（主动换行）是标签之间的边界；
     而文本框/可编辑区的视觉折行不会在文本里留下 \n，所以「换行 = 边界」这条不会误伤长标签。 */
  assert.equal(promptTagAt('\nlong hair\n',1),'long_hair');
  assert.equal(promptTagAt('solo\nlong hair\n1girl',9),'long_hair');
  assert.equal(promptTagAt('  \n  long hair  \n  ',6),'long_hair');
  assert.equal(normalizePromptTag('\n\tlong hair\r\n'),'long_hair');
  /* 一行一个标签时，落点在哪一行就取哪一行，不会把上下行带进来。 */
  assert.equal(promptTagAt('1girl\nlong hair\nsolo',8),'long_hair');
});
test('takoma 的 N::tag:: 权重写法也要剥掉，只搜标签',()=>{
  assert.equal(normalizePromptTag('0.6::t1kosewad::'),'t1kosewad');
  assert.equal(normalizePromptTag('0.6::long hair::'),'long_hair');
  assert.equal(normalizePromptTag('-1.2::lowres::'),'lowres');
  assert.equal(normalizePromptTag('1::solo::'),'solo');
  /* 整段提示词里按落点切片时，权重和标签在同一个逗号段里，一起进一起剥。 */
  assert.equal(promptTagAt('1girl, 0.6::t1kosewad::, solo',10),'t1kosewad');
  /* 没有权重壳的裸标签不能被误伤。 */
  assert.equal(normalizePromptTag('t1kosewad'),'t1kosewad');
});
test('已经是下划线写法的原样通过',()=>{
  assert.equal(promptTagAt('1girl, long_hair, solo',7),'long_hair');
});
