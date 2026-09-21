/* takoma 提示词助手（实验性）：在提示词界面里双击一个提示词，先查本机画师库，
   命中就把画师卡片浮出来（文字 + 最多 5 张库内预览）；没命中就给一条 Danbooru 搜索链接。
   只在 staging.takoma.app 注入（manifest 里限定），改坏了不影响别处。

   两个刻意的选择：
   1. 不用 getSelection().toString() —— 浏览器原生双击遇到空格就断，双击 long hair 只会给到 long。
      所以拿「整段文本 + 选区起点」，交给 prompt-tag.mjs 切出完整那一段。
   2. 标签的切片规则与「空格换下划线」都是 import 进来的：被单测覆盖的就是这里跑的那一份，
      不复制一遍，免得两边慢慢长歪。

   浮窗是固定 5 列 × 3 行：第一行是库内预览，后两行是 Danbooru —— 所以不管库有没有命中，
   Danbooru 那一路都要去搜。点任意一张图就地放大，再点一下回来。 */
(() => {
  const HOST_ID = 'artist-library-prompt-helper';
  const LARGE_URL = 'https://danbooru.donmai.us/posts?tags=';
  let lastTag = '';

  const promptTag = async (text, offset) => {
    const mod = await import(chrome.runtime.getURL('prompt-tag.mjs'));
    return mod.promptTagAt(text, offset);
  };
  /* 选区可能在 input/textarea（取 value），也可能在普通节点里（取 textContent）。
     两边都按同一个分隔符规则切，落点用选区的起点。 */
  const readSelection = () => {
    const selection = document.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const node = selection.anchorNode;
    if (!node) return null;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const field = element?.closest?.('input, textarea');
    if (field?.value != null) return { text: field.value, offset: selection.anchorOffset };
    const container = element?.closest?.('[contenteditable=""], [contenteditable="true"], .prompt, [class*=prompt]') || element;
    const text = container?.textContent || '';
    /* 偏移量必须用 Range 实量。先前是 text.indexOf(选区内已读过的前缀) 反推的：
       提示词里同一个词出现两次时（下一行又出现同样的词），indexOf 给的是第一次出现的位置，
       于是切出来的是别的那一段——表现就是「检索的不是当前选中的内容」。
       Range 从容器开头量到落点，重复文字也不会错。 */
    let offset = 0;
    try {
      const range = document.createRange();
      range.selectNodeContents(container);
      range.setEnd(node, selection.anchorOffset);
      offset = range.toString().length;
    } catch {
      offset = Math.max(0, text.indexOf(node.textContent?.slice(0, selection.anchorOffset) ?? ''));
    }
    return { text, offset };
  };
  const close = () => document.getElementById(HOST_ID)?.remove();
  const ask = (type, tag) => chrome.runtime.sendMessage({ type, tag }).catch(error => ({ ok: false, reason: '扩展没有回应：' + (error?.message || error) }));

  /* 缩略图高度：默认 250px，右上角滑杆可调。5 列铺满一行，不足 5 张用空占位补齐，
     行高才不会被撑得忽大忽小。 */
  let cellHeight = 250;
  const row = items => `<div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-top:6px">`
    + items.map(item => `<img src="${item.thumb}" alt="" data-large="${item.large || item.thumb}" title="点击看大图" style="width:100%;height:${cellHeight}px;object-fit:contain;background:#141b1d;border:1px solid #2a3538;border-radius:6px;cursor:zoom-in">`).join('')
    + Array.from({ length: Math.max(0, 5 - items.length) }, () => '<span></span>').join('')
    + `</div>`;

  const render = async tag => {
    close();
    const host = document.createElement('div');
    host.id = HOST_ID;
    Object.assign(host.style, { position: 'fixed', right: '24px', bottom: '24px', zIndex: '2147483647' });
    const root = host.attachShadow?.({ mode: 'open' }) || host;
    /* 宽度跟着画布走（takoma 的画布是 .tkCanvasPane），量不到就用 640 兜底，再夹进视口。
       要放得下 5 列，所以下限给到 420。 */
    const paneWidth = Math.round(document.querySelector('.tkCanvasPane')?.getBoundingClientRect?.().width || 0);
    const width = Math.max(420, Math.min(paneWidth || 640, Math.round(innerWidth * 0.94)));
    const box = document.createElement('div');
    Object.assign(box.style, { width: width + 'px', maxHeight: '80vh', overflow: 'auto', background: '#1b2224', color: '#e9efee', border: '1px solid #364346', borderRadius: '12px', boxShadow: '0 16px 50px #0008', font: '13px/1.6 "Segoe UI","Microsoft YaHei",sans-serif', padding: '12px' });
    box.textContent = `正在查「${tag}」…`;
    box.addEventListener('dblclick', event => event.stopPropagation());
    /* 点图看大图：就地换内容，再点一下回到列表。还原时要把滑杆重新接上——
       还原的是 innerHTML，监听器不会跟着回来，不重接滑杆就废了。 */
    const wireSlider = () => {
      const slider = box.querySelector('input[type="range"]');
      if (!slider) return;
      slider.addEventListener('input', () => {
        cellHeight = Number(slider.value) || 250;
        const label = box.querySelector('[data-size]');
        if (label) label.textContent = cellHeight + 'px';
        box.querySelectorAll('img[data-large]').forEach(image => { image.style.height = cellHeight + 'px'; });
      });
    };
    box.addEventListener('click', event => {
      const image = event.target?.closest?.('img[data-large]');
      if (!image) return;
      const list = box.innerHTML;
      box.innerHTML = `<img src="${image.dataset.large}" alt="" style="width:100%;max-height:70vh;object-fit:contain;background:#141b1d;border:1px solid #2a3538;border-radius:8px;cursor:zoom-out">`
        + `<div style="color:#8d9e9c;font-size:11px;margin-top:8px">点图片返回</div>`;
      box.querySelector('img')?.addEventListener('click', () => { box.innerHTML = list; wireSlider(); }, { once: true });
    });
    root.append(box);
    document.documentElement.append(host);
    /* 两路一起问：浮窗固定三行——第一行库内、后两行 Danbooru，所以不管库有没有命中都要搜站点。 */
    const [hit, remote] = await Promise.all([ask('takoma.lookup', tag), ask('takoma.danbooru', tag)]);
    if (document.getElementById(HOST_ID) !== host) return; /* 期间又双击了别的标签，这条结果作废 */
    const posts = (remote?.ok && Array.isArray(remote.posts) ? remote.posts : []).slice(0, 10);
    const countText = artist => artist.total == null ? '未读取' : artist.total + (artist.beforeTotal == null ? '' : `（${artist.beforeTotal}）`);
    const library = hit?.ok
      ? `<div style="margin-top:4px"><b style="font-size:14px">${hit.artist.name}</b>`
        + `<span style="color:#abbcb9"> ${[hit.artist.alias, hit.artist.category].filter(Boolean).join(' · ')}</span>`
        + `<div style="color:#abbcb9">作品数量 ${countText(hit.artist)}</div></div>`
        + (hit.thumbs?.length ? row(hit.thumbs.map(src => ({ thumb: src, large: src }))) : '')
      : `<div style="color:#abbcb9;margin-top:4px">本机画师库里没有「${tag}」</div>`;
    box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">`
      + `<b style="font-size:15px">${tag}</b>`
      + `<label style="margin-left:auto;display:flex;align-items:center;gap:6px;color:#8d9e9c;font-size:11px">缩略图 <input type="range" min="120" max="420" step="10" value="${cellHeight}" title="调整缩略图大小" style="width:110px"><span data-size>${cellHeight}px</span></label>`
      + `</div>`
      + library
      + `<div style="color:#8d9e9c;font-size:11px;margin-top:10px">Danbooru${posts.length ? ` 前 ${posts.length} 张` : ''}</div>`
      + (posts.length ? row(posts) : '<div style="color:#8d9e9c">站点没有返回图片</div>')
      + `<a href="${LARGE_URL}${encodeURIComponent(tag)}" target="_blank" rel="noopener" style="color:#a5dfcc;display:inline-block;margin-top:10px">在 Danbooru 打开「${tag}」 →</a>`
      + `<div style="color:#8d9e9c;font-size:11px;margin-top:6px">双击别处或按 Esc 关闭</div>`;
    wireSlider();
  };

  document.addEventListener('dblclick', async event => {
    if (event.target?.closest?.(`#${HOST_ID}`)) return;
    const picked = readSelection();
    if (!picked || !picked.text) return;
    let tag = '';
    try { tag = await promptTag(picked.text, picked.offset); } catch { return; }
    if (!tag || tag === lastTag) return; /* 同一个标签连着双击不重复弹 */
    lastTag = tag;
    render(tag);
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); }, true);
  document.addEventListener('click', event => { if (!event.target?.closest?.(`#${HOST_ID}`)) close(); }, true);
})();
