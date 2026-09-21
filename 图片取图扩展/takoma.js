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

  const promptModule = () => import(chrome.runtime.getURL('prompt-tag.mjs'));
  /* 选区可能在 input/textarea（取 value + 光标位置），也可能在普通节点里。
     普通节点这一路**不再自己拼 textContent + Range**（两套坐标系在块级元素边界上对不上，
     标签又是相邻元素，于是切片把上下行一起吞了）；改成把「容器 + 落点」交给
     prompt-tag.mjs 里同一套拼接规则去算。 */
  const readSelection = () => {
    const selection = document.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const node = selection.anchorNode;
    if (!node) return null;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const field = element?.closest?.('input, textarea');
    if (field?.value != null) return { field, text: field.value, offset: selection.anchorOffset };
    const container = element?.closest?.('[contenteditable=""], [contenteditable="true"], .prompt, [class*=prompt]') || element;
    return { container, node, offset: selection.anchorOffset };
  };
  const close = () => document.getElementById(HOST_ID)?.remove();
  const ask = (type, tag, page) => chrome.runtime.sendMessage({ type, tag, page }).catch(error => ({ ok: false, reason: '扩展没有回应：' + (error?.message || error) }));
  /* 浮窗的位置/尺寸/缩略图大小记在 chrome.storage.local（manifest 里本来就有 storage 权限）。
     内容脚本存自己的东西，不碰画师库的数据。 */
  const LAYOUT_KEY = 'takoma-helper.layout';
  const loadLayout = async () => { try { return (await chrome.storage.local.get(LAYOUT_KEY))?.[LAYOUT_KEY] || {}; } catch { return {}; } };
  const saveLayout = layout => { try { chrome.storage.local.set({ [LAYOUT_KEY]: layout }); } catch {} };

  /* 缩略图高度：默认 250px，右上角滑杆可调。5 列铺满一行，不足 5 张用空占位补齐，
     行高才不会被撑得忽大忽小。 */
  let cellHeight = 250;
  /* 列数不写死：按缩略图大小自动适配——图越大一行放得越少。
     自然宽度按 0.75 倍估（object-fit:contain 的常见比例），minmax 的下限就用它。 */
  const row = items => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${Math.round(cellHeight * 0.75)}px,1fr));gap:6px;margin-top:6px">`
    + items.map(item => `<img src="${item.thumb}" alt=""${item.uid != null ? ` data-uid="${item.uid}" data-index="${item.index}"` : ` data-large="${item.large || item.thumb}"`} title="点击看大图" style="width:100%;height:${cellHeight}px;object-fit:contain;background:#141b1d;border:1px solid #2a3538;border-radius:6px;cursor:zoom-in">`).join('')
    + `</div>`;

  /* page 是给翻页用的：翻页时整块重画一次，位置尺寸从记住的配置里来，所以观感是连续的。
     只重画面板、不重新绑定双击——翻页按钮走的就是这条路径。 */
  const render = async (tag, page = 1) => {
    close();
    const layout = await loadLayout();
    const host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow?.({ mode: 'open' }) || host;
    /* 位置和尺寸优先用上次的（用户拖过就按用户的来）；没存过就贴着右下角，
       宽度跟着画布走（takoma 的画布是 .tkCanvasPane），量不到用 640 兜底，再夹进视口。 */
    const paneWidth = Math.round(document.querySelector('.tkCanvasPane')?.getBoundingClientRect?.().width || 0);
    const width = Math.max(360, Math.min(Number(layout.width) || paneWidth || 640, Math.round(innerWidth * 0.94)));
    const height = Math.max(240, Math.min(Number(layout.height) || 460, Math.round(innerHeight * 0.9)));
    const left = Number.isFinite(layout.left) ? Math.max(0, Math.min(layout.left, innerWidth - 120)) : Math.max(0, innerWidth - 24 - width);
    const top = Number.isFinite(layout.top) ? Math.max(0, Math.min(layout.top, innerHeight - 80)) : Math.max(0, Math.round(innerHeight / 2 - height / 2));
    if (Number.isFinite(layout.cell)) cellHeight = Math.max(120, Math.min(420, layout.cell));
    Object.assign(host.style, { position: 'fixed', left: left + 'px', top: top + 'px', zIndex: '2147483647' });
    const box = document.createElement('div');
    /* resize:both 用浏览器原生的缩放手柄，不必自己写拖拽角；overflow 不是 visible 才生效。 */
    Object.assign(box.style, { width: width + 'px', height: height + 'px', maxHeight: '90vh', overflow: 'auto', resize: 'both', background: '#1b2224', color: '#e9efee', border: '1px solid #364346', borderRadius: '12px', boxShadow: '0 16px 50px #0008', font: '13px/1.6 "Segoe UI","Microsoft YaHei",sans-serif', padding: '12px' });
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
    box.addEventListener('click', async event => {
      const image = event.target?.closest?.('img[src]');
      if (!image) return;
      const list = box.innerHTML;
      let src = image.dataset.large || image.src;
      /* 库内的图带 uid/index：点开时才去要原图（懒加载）——查询时把 5 张原图 base64
         一起塞进消息太重。站点那边的图直接用它自己给的 file_url。 */
      if (image.dataset.uid != null) {
        try {
          const big = await chrome.runtime.sendMessage({ type: 'takoma.lookup-large', uid: image.dataset.uid, index: Number(image.dataset.index) || 0 });
          if (big?.ok && big.url) src = big.url;
        } catch {}
        if (document.getElementById(HOST_ID) !== host) return; /* 期间又双击了别的标签，别往旧浮窗里塞图 */
      }
      box.innerHTML = `<img src="${src}" alt="" style="width:100%;max-height:70vh;object-fit:contain;background:#141b1d;border:1px solid #2a3538;border-radius:8px;cursor:zoom-out">`
        + `<div style="color:#8d9e9c;font-size:11px;margin-top:8px">点图片返回</div>`;
      box.querySelector('img')?.addEventListener('click', () => { box.innerHTML = list; wireSlider(); }, { once: true });
    });
    root.append(box);
    document.documentElement.append(host);
    /* 两路一起问：浮窗固定三行——第一行库内、后两行 Danbooru，所以不管库有没有命中都要搜站点。 */
    const [hit, remote] = await Promise.all([ask('takoma.lookup', tag), ask('takoma.danbooru', tag, page)]);
    if (document.getElementById(HOST_ID) !== host) return; /* 期间又双击了别的标签，这条结果作废 */
    if (remote?.ok && Number(remote.page) > 0) page = Number(remote.page);
    const posts = (remote?.ok && Array.isArray(remote.posts) ? remote.posts : []).slice(0, 10);
    const countText = artist => artist.total == null ? '未读取' : artist.total + (artist.beforeTotal == null ? '' : `（${artist.beforeTotal}）`);
    const library = hit?.ok
      ? `<div style="margin-top:4px"><b style="font-size:14px">${hit.artist.name}</b>`
        + `<span style="color:#abbcb9"> ${[hit.artist.alias, hit.artist.category].filter(Boolean).join(' · ')}</span>`
        + `<div style="color:#abbcb9">作品数量 ${countText(hit.artist)}</div></div>`
        + (hit.thumbs?.length ? row(hit.thumbs.map((src, index) => ({ thumb: src, uid: hit.artist.uid, index }))) : '')
      : `<div style="color:#abbcb9;margin-top:4px">本机画师库里没有「${tag}」</div>`;
    box.innerHTML = `<div data-drag style="font-size:15px;font-weight:600;cursor:move;user-select:none">${tag}</div>`
      + library
      + `<div style="display:flex;align-items:center;gap:8px;margin-top:10px;color:#8d9e9c;font-size:11px;flex-wrap:wrap">`
      + `<span>Danbooru 第 ${page} 页${posts.length ? '' : '（没有结果）'}</span>`
      + `<button data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} style="background:#252935;color:#e9efee;border:1px solid #364346;border-radius:6px;padding:2px 8px;cursor:pointer">‹ 上一页</button>`
      + `<button data-page="${page + 1}" ${posts.length ? '' : 'disabled'} style="background:#252935;color:#e9efee;border:1px solid #364346;border-radius:6px;padding:2px 8px;cursor:pointer">下一页 ›</button>`
      + `</div>`
      + (posts.length ? row(posts) : '<div style="color:#8d9e9c">站点没有返回图片</div>')
      + `<div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">`
      + `<a href="${LARGE_URL}${encodeURIComponent(tag)}" target="_blank" rel="noopener" style="color:#a5dfcc">在 Danbooru 打开「${tag}」 →</a>`
      + `<label style="margin-left:auto;display:flex;align-items:center;gap:6px;color:#8d9e9c;font-size:11px">缩略图 <input type="range" min="120" max="420" step="10" value="${cellHeight}" title="调整缩略图大小" style="width:120px"><span data-size>${cellHeight}px</span></label>`
      + `</div>`
      + `<div style="color:#8d9e9c;font-size:11px;margin-top:6px">双击别处或按 Esc 关闭</div>`;
    wireSlider();
    /* 翻页：重画面板时会带上新页码。库内那一行会跟着一起重画，但它查的是同一个标签、
       结果一样，观感上没有变化；换来的是不必为翻页单写一套增量渲染。 */
    box.querySelectorAll('button[data-page]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const next = Number(button.dataset.page) || 1;
      if (next >= 1 && next !== page) render(tag, next);
    }));
    /* 拖动：按标题条移动（图片区域留给点开看大图，不抢手势）。
       位置取 style.left/top 而不是 offsetLeft——fixed 元素没有 offsetParent，offsetLeft 会是 0。 */
    const position = () => ({ left: parseFloat(host.style.left) || 0, top: parseFloat(host.style.top) || 0 });
    const remember = () => { const { left: x, top: y } = position(); saveLayout({ left: x, top: y, width: box.offsetWidth, height: box.offsetHeight, cell: cellHeight }); };
    box.querySelector('[data-drag]')?.addEventListener('pointerdown', event => {
      const start = position(), offsetX = event.clientX - start.left, offsetY = event.clientY - start.top;
      const move = moveEvent => {
        host.style.left = Math.max(0, Math.min(moveEvent.clientX - offsetX, innerWidth - 60)) + 'px';
        host.style.top = Math.max(0, Math.min(moveEvent.clientY - offsetY, innerHeight - 40)) + 'px';
      };
      const done = () => { document.removeEventListener('pointermove', move); remember(); };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', done, { once: true });
      event.preventDefault();
    });
    /* 原生缩放手柄没有回调，松手时记一次；滑杆拖完也会冒 pointerup，一并记住。 */
    box.addEventListener('pointerup', remember);
  };

  document.addEventListener('dblclick', async event => {
    if (event.target?.closest?.(`#${HOST_ID}`)) return;
    const picked = readSelection();
    if (!picked) return;
    let tag = '';
    try {
      const mod = await promptModule();
      tag = picked.field ? mod.promptTagAt(picked.text, picked.offset) : mod.promptTagIn(picked.container, picked.node, picked.offset);
    } catch { return; }
    if (!tag || tag === lastTag) return; /* 同一个标签连着双击不重复弹 */
    lastTag = tag;
    render(tag);
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); }, true);
  document.addEventListener('click', event => { if (!event.target?.closest?.(`#${HOST_ID}`)) close(); }, true);
})();
