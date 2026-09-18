import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),id=require('./app/artist-id.js');
test('标识由 序号-画师tag-编号 组成，序号固定补足 4 位',()=>{
  assert.equal(id.create({seq:1,name:'iuui',danbooruId:196870}),'0001-iuui-196870');
  assert.equal(id.create({seq:42,name:'kure-na',danbooruId:379891}),'0042-kure-na-379891');
  assert.equal(id.create({seq:9999,name:'a',danbooruId:1}),'9999-a-1');
  assert.equal(id.create({seq:10000,name:'a',danbooruId:1}),'10000-a-1','超出 4 位后自然加宽');
});
test('手动画师没有编号时用 manual 兜底，序号或编号非法直接报错',()=>{
  assert.equal(id.create({seq:7,name:'我的画师',danbooruId:null}),'0007-我的画师-manual');
  assert.equal(id.create({seq:7,name:'x',danbooruId:0}),'0007-x-manual');
  for(const bad of [{seq:0,name:'a'},{seq:-2,name:'a'},{seq:1.5,name:'a'},{seq:'x',name:'a'},{name:'a'}])assert.throws(()=>id.create(bad),/序号/);
});
test('名字里的空格、斜杠、控制字符被替换，不会逃出目录层级',()=>{
  assert.equal(id.clean('a b/c'),'a_b_c');
  assert.equal(id.clean('../etc/passwd'),'etc_passwd');
  assert.equal(id.clean('CON'),'CON');
  assert.equal(id.clean('   '),'artist');
  assert.equal(id.clean('!!!'),'artist');
  assert.equal(id.clean('a'.repeat(200)).length,id.NAME_MAX);
  const uid=id.create({seq:3,name:'../../evil',danbooruId:5});
  assert.equal(uid,'0003-evil-5','连续非法字符塌缩成一个下划线后被剥掉');
  assert.equal(uid.includes('/'),false);
  assert.equal(uid.includes('.'),false,'标识里不允许出现点号，避免 .. 逃逸');
  assert.equal(id.create({seq:3,name:'..',danbooruId:5}),'0003-artist-5','名字被清空时回落到默认名');
});
test('parse 能还原序号、名字与编号，兼容名字自带连字符和数字',()=>{
  assert.deepEqual(id.parse('0001-iuui-196870'),{seq:1,name:'iuui',danbooruId:196870});
  assert.deepEqual(id.parse('0002-kure-na-manual'),{seq:2,name:'kure-na',danbooruId:null});
  assert.deepEqual(id.parse('0004-hatsune-miku-39'),{seq:4,name:'hatsune-miku',danbooruId:39});
  assert.equal(id.parse('danbooru-196870'),null,'旧版标识没有序号段');
  assert.equal(id.parse(''),null);
});
test('valid 只接受文件系统安全的目录名，拒绝路径穿越',()=>{
  for(const good of ['0001-iuui-196870','0007-我的画师-manual','danbooru-196870','a'.repeat(100)])assert.equal(id.valid(good),true,good);
  for(const bad of ['',null,undefined,'../wrong','a/b','a\\b','a b','a.b','a'.repeat(101)])assert.equal(id.valid(bad),false,String(bad));
});
test('发号跳过已用序号，删除后留空不回收，新画师永远拿最大号加一',()=>{
  assert.equal(id.nextSeq([]),1);
  assert.equal(id.nextSeq(['0001-a-1','0002-b-2','0003-c-3']),4);
  assert.equal(id.nextSeq(['0001-a-1','0005-e-5']),6,'中间空缺不回收');
  assert.equal(id.nextSeq(['danbooru-196870','0002-b-2']),3,'旧标识不参与发号');
  assert.equal(id.issue([{uid:'0009-x-9'}],{name:'iuui',danbooruId:196870}),'0010-iuui-196870');
});
