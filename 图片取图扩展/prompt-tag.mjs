/* takoma 提示词助手要用的两个纯函数：从双击落点摘出「一个完整提示词」，再规整成可搜索的形式。
   单独成文件、单独测：注入脚本本身跑在别人的页面上，不适合当测试宿主；
   而这两条规则（完整标签 + 空格换下划线）恰恰是最容易写错、也最该钉死的部分。 */

/* 提示词之间的分隔符：半角/全角逗号、分号、竖线、换行。
   为什么要自己切：浏览器原生的「双击选中一个词」遇到空格就断，
   双击 long hair 只会选中 long，所以不能直接用 getSelection() 的结果。 */
const SEPARATOR=/[,，;；|\n\r]/;

/* 取落点所在的那一段提示词。offset 是选区在整段文本里的起始下标。 */
export function pickPromptTag(text,offset){
  const source=String(text??'');
  const at=Math.max(0,Math.min(Number.isFinite(Number(offset))?Number(offset):0,source.length));
  let start=at,end=at;
  while(start>0&&!SEPARATOR.test(source[start-1]))start--;
  while(end<source.length&&!SEPARATOR.test(source[end]))end++;
  return source.slice(start,end);
}

/* 规整成能拿去搜的形式：
   - 去掉两头的空白与残留分隔符；内部连续空白（含全角空格）收成一个下划线；
   - 权重写法一律剥掉，只留标签本身——搜索要的是标签，不是权重：
     takoma 的 0.6::t1kosewad:: 、WebUI 的 (tag:1.2) 、以及 [tag] / {tag} 三种写法都认。 */
export function normalizePromptTag(value){
  return String(value??'')
    .trim()
    /* 只剥**成对包住整串**的括号：'(long hair:1.2)' → 'long hair'。
       不能见括号就剥——'yuuka (blue archive)' 尾巴上那个 ) 是标签自己的一部分，
       剥掉就变成 'yuuka (blue archive'（用户实际遇到的就是这个被截断的现象）。 */
    .replace(/^\(([^()]*)\)$/,'$1')
    .replace(/^\[([^\[\]]*)\]$/,'$1')
    .replace(/^\{([^{}]*)\}$/,'$1')
    .replace(/:\s*[\d.]+$/,'')
    /* N::tag:: —— takoma 的权重写法：数字（可带正负号）和 :: 都是外壳，中间才是标签。
       先剥前壳再剥后壳，标签里的冒号才不会被误伤。 */
    .replace(/^[+-]?[\d.]+\s*::/,'')
    .replace(/::\s*$/,'')
    .trim()
    .replace(/[\s\u3000]+/g,'_')
    .replace(/^[_,;，；|]+|[_,;，；|]+$/g,'');
}

/* 一步到位：给整段提示词和落点，返回可搜索的标签。空串表示这段没有可搜的内容。 */
export function promptTagAt(text,offset){
  return normalizePromptTag(pickPromptTag(text,offset));
}
