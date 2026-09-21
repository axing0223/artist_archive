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

/* ── 从 DOM 取「一段文本 + 偏移量」──────────────────────────────────────
   提示词面板里标签往往是**相邻的元素**（一行一个 div），而不是同一段文本里的 \n。
   这时 textContent 会把它们直接粘起来（1girlsolo），按分隔符切片就把上下行一起吞了——
   用户连着两轮报的「仍然会选中上下行的内容」就是这个。
   所以自己拼：走文本节点，遇到块级元素就在两侧补一个 \n。
   关键点：拼文本和算偏移必须**同一套规则**，否则 Range 的偏移量和拼出来的文本对不上
   （原先就是两套坐标系，所以修不掉）。下面两个函数用同一份游走逻辑，测试里有一条
   专门断言两者在同一个树上是自洽的。 */
const BLOCK_TAGS=new Set(['DIV','P','LI','TR','TD','TH','SECTION','ARTICLE','ASIDE','UL','OL','BR','HR','H1','H2','H3','H4','H5','H6','TABLE','TBODY','FIGURE','BLOCKQUOTE','PRE','NAV','HEADER','FOOTER','MAIN']);
const isBlock=node=>BLOCK_TAGS.has(String(node?.tagName||'').toUpperCase());

export function promptTextOf(root){
  let text='',tail=true;
  const newline=()=>{if(!tail){text+='\n';tail=true;}};
  const walk=current=>{
    for(const child of current?.childNodes||[]){
      if(child.nodeType===3){
        const data=child.data??child.textContent??'';
        text+=data;if(data)tail=/\n$/.test(data);
        continue;
      }
      if(child.nodeType!==1)continue;
      const block=isBlock(child);
      if(block)newline();
      walk(child);
      if(block)newline();
    }
  };
  walk(root);
  return text;
}

export function offsetInPromptText(root,node,offset){
  let total=0,found=false,tail=true;
  const newline=()=>{if(!tail){total++;tail=true;}};
  const walk=current=>{
    for(const child of current?.childNodes||[]){
      if(found)return;
      if(child.nodeType===3){
        const data=child.data??child.textContent??'';
        if(child===node){total+=Math.max(0,Math.min(Number.isFinite(Number(offset))?Number(offset):0,data.length));found=true;return;}
        total+=data.length;if(data)tail=/\n$/.test(data);
        continue;
      }
      if(child.nodeType!==1)continue;
      const block=isBlock(child);
      if(block)newline();
      walk(child);
      if(block)newline();
    }
  };
  walk(root);
  return total;
}

/* 组合用法：text 和 offset 一次拿全，调用方不用自己保证两套坐标系一致。 */
export function promptTagIn(root,node,offset){
  return promptTagAt(promptTextOf(root),offsetInPromptText(root,node,offset));
}
