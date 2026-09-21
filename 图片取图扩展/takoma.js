/* takoma 提示词助手（实验性）：在提示词界面里双击一个提示词，先查本机画师库，
   命中就把画师卡片浮出来（文字 + 最多 5 张库内预览）；没命中就给一条 Danbooru 搜索链接。
   只在 staging.takoma.app 注入（manifest 里限定），改坏了不影响别处。

   几个刻意的选择：
   1. 不用 getSelection().toString() —— 浏览器原生双击遇到空格就断，双击 long hair 只会给到 long。
      所以拿「容器 + 落点」，交给 prompt-tag.mjs 按块级边界切出完整那一段。
   2. 标签的切片规则、空格换下划线、权重剥壳都是 import 进来的：被单测覆盖的就是这里跑的那一份。
   3. 浮窗位置固定右下角，只允许在左上角拖手柄改尺寸（用户明确不要自由拖动）。
      面板是 right/bottom 定位，所以往左上拖变大会自然向左上生长，右下的锚点不动。
   4. 翻页只重画 Danbooru 那一段：它有独立的容器，标题、库内一行、底部控件都不动。
   5. 点缩略图弹二级界面看原图，点图片以外任何地方或按 Esc 关闭。 */
(() => {
  const HOST_ID = 'artist-library-prompt-helper';
  const VIEWER_ID = 'artist-library-prompt-helper-viewer';
  const LAYOUT_KEY = 'takoma-helper.layout';
  const LARGE_URL = 'https://danbooru.donmai.us/posts?tags=';
  let lastTag = '';

  const close = () => document.getElementById(HOST_ID)?.remove();
  const closeViewer = () => document.getElementById(VIEWER_ID)?.remove();
  const loadLayout = async () => { try { return (await chrome.storage.local.get(LAYOUT_KEY))?.[LAYOUT_KEY] || {}; } catch { return {}; } };
  const saveLayout = layout => { try { chrome.storage.local.set({ [LAYOUT_KEY]: layout }); } catch {} };
  const ask = (type, tag, page) => chrome.runtime.sendMessage({ type, tag, page }).catch(error => ({ ok: false, reason: '扩展没有回应：' + (error?.message || error) }));

  /* 选区可能在 input/textarea（取 value + 光标位置），也可能在普通节点里。
     普通节点这一路把「容器 + 落点」交给 prompt-tag.mjs 里同一套拼接规则去算：
     拼 textContent + Range 两套坐标系在块级边界上对不上，会把上下行一起吞掉。 */
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

  /* 缩略图尺寸：滑杆调的是**格子宽度**，高度按 0.75 跟着一起变——
     用户要的是「宽高同时调整」，所以不能让高度单独动而宽度不动。
     列数随之自适应：格子越大，一行放得越少。 */
  let cellWidth = 250;
  const cellHeight = () => Math.round(cellWidth * 0.75);
  const row = items => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${cellWidth}px,1fr));gap:6px;margin-top:6px">`
    + items.map(item => `<img src="${item.thumb}" alt=""${item.uid != null ? ` data-uid="${item.uid}" data-index="${item.index}"` : ` data-large="${item.large || item.thumb}"`} title="点击看原图" style="width:100%;height:${cellHeight()}px;object-fit:contain;background:#141b1d;border:1px solid #2a3538;border-radius:6px;cursor:zoom-in">`).join('')
    + `</div>`;

  /* 二级界面：只装一张原图，铺满视口。点图片以外的任何地方都关掉；
     图片本身吃掉点击，免得在图上松手也关。Esc 由下面的 keydown 统一处理。 */
  const showViewer = src => {
    closeViewer();
    const host = document.createElement('div');
    host.id = VIEWER_ID;
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: '#080b14e6', display: 'grid', placeItems: 'center', cursor: 'zoom-out' });
    const image = document.createElement('img');
    image.src = src;
    image.alt = '';
    Object.assign(image.style, { maxWidth: '94vw', maxHeight: '94vh', objectFit: 'contain', background: '#141b1d', border: '1px solid #364346', borderRadius: '8px', cursor: 'default' });
    image.addEventListener('click', event => event.stopPropagation());
    host.append(image);
    host.addEventListener('click', closeViewer);
    document.documentElement.append(host);
  };

  const render = async (tag, page = 1) => {
    close();
    closeViewer();
    const layout = await loadLayout();
    if (Number.isFinite(layout.cell)) cellWidth = Math.max(120, Math.min(420, layout.cell));
    const host = document.createElement('div');
    host.id = HOST_ID;
    /* 位置固定右下角，不再让用户拖；只记住尺寸。 */
    const width = Math.max(320, Math.min(Number(layout.width) || 640, Math.round(innerWidth * 0.94)));
    const height = Math.max(240, Math.min(Number(layout.height) || 480, Math.round(innerHeight * 0.9)));
    Object.assign(host.style, { position: 'fixed', right: '24px', bottom: '24px', width: width + 'px', height: height + 'px', zIndex: '2147483647' });
    const root = host.attachShadow?.({ mode: 'open' }) || host;
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'relative', width: '100%', height: '100%', overflow: 'auto', background: '#1b2224', color: '#e9efee', border: '1px solid #364346', borderRadius: '12px', boxShadow: '0 16px 50px #0008', font: '13px/1.6 "Segoe UI","Microsoft YaHei",sans-serif', padding: '12px', boxSizing: 'border-box' });
    box.textContent = `正在查「${tag}」…`;
    box.addEventListener('dblclick', event => event.stopPropagation());
    root.append(box);
    document.documentElement.append(host);

    /* 左上角的缩放手柄：往左上拖变大。面板是 right/bottom 定位，
       所以只改宽高就会自然向左上生长，右下角锚点不动。 */
    const grip = document.createElement('div');
    grip.title = '拖动调整大小';
    Object.assign(grip.style, { position: 'absolute', left: '0', top: '0', width: '16px', height: '16px', cursor: 'nwse-resize', zIndex: '1', background: 'linear-gradient(135deg,#364346 0 50%,transparent 50%)', borderRadius: '12px 0 0 0' });
    grip.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX, startY = event.clientY, startWidth = box.offsetWidth, startHeight = box.offsetHeight;
      const move = moveEvent => {
        host.style.width = Math.max(320, startWidth - (moveEvent.clientX - startX)) + 'px';
        host.style.height = Math.max(240, startHeight - (moveEvent.clientY - startY)) + 'px';
      };
      const done = () => {
        document.removeEventListener('pointermove', move);
        saveLayout({ width: host.offsetWidth, height: host.offsetHeight, cell: cellWidth });
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', done, { once: true });
    });
    root.append(grip);

    /* 点缩略图 → 二级界面。库内的图带 uid/index，点开时才去要原图（懒加载，
       查询时把 5 张原图 base64 一起塞进消息太重）；站点那侧的图直接用它给的 file_url。 */
    box.addEventListener('click', async event => {
      const image = event.target?.closest?.('img[src]');
      if (!image) return;
      let src = image.dataset.large || image.src;
      if (image.dataset.uid != null) {
        try {
          const big = await chrome.runtime.sendMessage({ type: 'takoma.lookup-large', uid: image.dataset.uid, index: Number(image.dataset.index) || 0 });
          if (big?.ok && big.url) src = big.url;
        } catch {}
        if (document.getElementById(HOST_ID) !== host) return;
      }
      showViewer(src);
    });

    const [hit, remote] = await Promise.all([ask('takoma.lookup', tag), ask('takoma.danbooru', tag, page)]);
    if (document.getElementById(HOST_ID) !== host) return; /* 期间又双击了别的标签，这条结果作废 */
    if (remote?.ok && Number(remote.page) > 0) page = Number(remote.page);

    const countText = artist => artist.total == null ? '未读取' : artist.total + (artist.beforeTotal == null ? '' : `（${artist.beforeTotal}）`);
    const library = hit?.ok
      ? `<div style="margin-top:4px"><b style="font-size:14px">${hit.artist.name}</b>`
        + `<span style="color:#abbcb9"> ${[hit.artist.alias, hit.artist.category].filter(Boolean).join(' · ')}</span>`
        + `<div style="color:#abbcb9">作品数量 ${countText(hit.artist)}</div></div>`
        + (hit.thumbs?.length ? row(hit.thumbs.map((src, index) => ({ thumb: src, uid: hit.artist.uid, index }))) : '')
      : `<div style="color:#abbcb9;margin-top:4px">本机画师库里没有「${tag}」</div>`;
    box.innerHTML = `<div style="font-size:15px;font-weight:600">${tag}</div>`
      + library
      + `<div data-remote style="margin-top:10px"></div>`
      + `<div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">`
      + `<a href="${LARGE_URL}${encodeURIComponent(tag)}" target="_blank" rel="noopener" style="color:#a5dfcc">在 Danbooru 打开「${tag}」 →</a>`
      + `<label style="margin-left:auto;display:flex;align-items:center;gap:6px;color:#8d9e9c;font-size:11px">缩略图 <input type="range" min="120" max="420" step="10" value="${cellWidth}" title="调整缩略图大小（宽高一起变）" style="width:120px"><span data-size>${cellWidth}×${cellHeight()}</span></label>`
      + `</div>`
      + `<div style="color:#8d9e9c;font-size:11px;margin-top:6px">双击别处、按 Esc 或点面板外关闭</div>`;

    /* 只重画 Danbooru 那一段：翻页时标题、库内一行、底部控件都不动。 */
    const paintRemote = (posts, at) => {
      const holder = box.querySelector('[data-remote]');
      if (!holder) return;
      holder.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:#8d9e9c;font-size:11px;flex-wrap:wrap">`
        + `<span>Danbooru 第 ${at} 页</span>`
        + `<button data-page="${at - 1}" ${at <= 1 ? 'disabled' : ''} style="background:#252935;color:#e9efee;border:1px solid #364346;border-radius:6px;padding:2px 8px;cursor:pointer">‹ 上一页</button>`
        + `<button data-page="${at + 1}" ${posts.length ? '' : 'disabled'} style="background:#252935;color:#e9efee;border:1px solid #364346;border-radius:6px;padding:2px 8px;cursor:pointer">下一页 ›</button>`
        + `</div>`
        + (posts.length ? row(posts) : '<div style="color:#8d9e9c">站点没有返回图片</div>');
      holder.querySelectorAll('button[data-page]').forEach(button => button.addEventListener('click', async event => {
        event.stopPropagation();
        const next = Number(button.dataset.page) || 1;
        if (next < 1 || next === at) return;
        button.disabled = true;
        const answer = await ask('takoma.danbooru', tag, next);
        if (document.getElementById(HOST_ID) !== host) return;
        const list = answer?.ok && Array.isArray(answer.posts) ? answer.posts : [];
        paintRemote(list, answer?.ok && Number(answer.page) > 0 ? Number(answer.page) : next);
      }));
    };
    paintRemote(remote?.ok && Array.isArray(remote.posts) ? remote.posts : [], page);

    const slider = box.querySelector('input[type="range"]');
    slider?.addEventListener('input', () => {
      cellWidth = Number(slider.value) || 250;
      const label = box.querySelector('[data-size]');
      if (label) label.textContent = cellWidth + '×' + cellHeight();
      /* 宽高一起变：重画两段图片即可，标题与控件不动。 */
      box.querySelectorAll('img[data-large],img[data-uid]').forEach(image => { image.style.height = cellHeight() + 'px'; });
      box.querySelectorAll('div[style*="grid"]').forEach(grid => { grid.style.gridTemplateColumns = `repeat(auto-fill,minmax(${cellWidth}px,1fr))`; });
      saveLayout({ width: host.offsetWidth, height: host.offsetHeight, cell: cellWidth });
    });
  };

  document.addEventListener('dblclick', async event => {
    if (event.target?.closest?.(`#${HOST_ID}, #${VIEWER_ID}`)) return;
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
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (document.getElementById(VIEWER_ID)) closeViewer(); /* 先关二级界面，再关面板 */
    else close();
  }, true);
  document.addEventListener('click', event => {
    if (document.getElementById(VIEWER_ID)) return; /* 二级界面自己处理关闭 */
    if (!event.target?.closest?.(`#${HOST_ID}`)) close();
  }, true);
})();
