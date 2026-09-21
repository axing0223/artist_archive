/* takoma 提示词助手（实验性）：在提示词界面里双击一个提示词，先查本机画师库，
   命中就把画师卡片浮出来（文字 + 最多 5 张库内预览）；没命中就给 Danbooru 的搜索结果。
   只在 staging.takoma.app 注入（manifest 里限定），改坏了不影响别处。

   几个刻意的选择：
   1. 不用 getSelection().toString() —— 浏览器原生双击遇到空格就断，双击 long hair 只会给到 long。
      所以拿「容器 + 落点」，交给 prompt-tag.mjs 按块级边界切出完整那一段。
   2. 标签的切片规则、空格换下划线、权重剥壳都是 import 进来的：被单测覆盖的就是这里跑的那一份。
   3. 浮窗位置固定右下角，只允许在左上角拖手柄改尺寸（用户明确不要自由拖动）。
      面板是 right/bottom 定位，所以往左上拖变大会自然向左上生长，右下的锚点不动。
   4. 翻页只重画 Danbooru 那一段：它有独立的容器，标题、库内一行、底部控件都不动。
   5. 点缩略图弹二级界面看原图，点图片以外任何地方或按 Esc 关闭。
   6. 表现层：面板和二级界面各自把一份样式表挂进自己的 shadow root（既不读站点 CSS，
      也不会漏出去污染站点），尺寸类的东西尽量交给 CSS 自己算，JS 只管数据。
   7. 缩略图以**竖图**为标准：格子本身就是 3:4 的竖格，图片 cover 铺满不留空白；
      横图会被裁掉上下，要看不裁的原图就点开二级界面。改格子宽度时高度靠 aspect-ratio 自动跟随。 */
(() => {
  const HOST_ID = 'artist-library-prompt-helper';
  const VIEWER_ID = 'artist-library-prompt-helper-viewer';
  const VIEWER_CLASS = 'tk-viewer';
  const LAYOUT_KEY = 'takoma-helper.layout';
  const LARGE_URL = 'https://danbooru.donmai.us/posts?tags=';
  let lastTag = '';

  const close = () => document.getElementById(HOST_ID)?.remove();
  const closeViewer = () => document.getElementById(VIEWER_ID)?.remove();
  const loadLayout = async () => { try { return (await chrome.storage.local.get(LAYOUT_KEY))?.[LAYOUT_KEY] || {}; } catch { return {}; } };
  const saveLayout = layout => { try { chrome.storage.local.set({ [LAYOUT_KEY]: layout }); } catch {} };
  const ask = (type, tag, page) => chrome.runtime.sendMessage({ type, tag, page }).catch(error => ({ ok: false, reason: '扩展没有回应：' + (error?.message || error) }));
  /* 切片规则从 prompt-tag.mjs 动态 import：被单测覆盖的就是这里跑的那一份，不复制第二份。
     （上一版整段重写时漏了这个定义，dblclick 里 await 它抛 ReferenceError，
       又被 try/catch 静静吞掉——表现就是「双击完全没反应」。） */
  const promptModule = () => import(chrome.runtime.getURL('prompt-tag.mjs'));
  /* 标签和画师名都来自页面/本机库，拼进 innerHTML 前统一转义。 */
  const esc = value => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

  /* 样式全在这里。面板挂到 .tk 那份 shadow root，二级界面挂到自己那份，
     所以同一份文本里既有 .tk 的规则，也有 :host(.tk-viewer) 的规则。 */
  const CSS = `
.tk{--fg:#e9eff2;--muted:#8fa0ab;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.17);--surf:rgba(255,255,255,.045);--surf2:rgba(255,255,255,.085);--accent:#5eead4;--accent-dim:rgba(94,234,212,.13);--warn:#fbbf24;
  position:relative;width:100%;height:100%;box-sizing:border-box;overflow:auto;overscroll-behavior:contain;border-radius:16px;
  background:linear-gradient(168deg,#161d22,#0c1114 72%);border:1px solid var(--line2);color:var(--fg);text-align:left;
  font:13px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  box-shadow:0 30px 80px -22px rgba(0,0,0,.85),0 0 0 1px rgba(0,0,0,.45);backdrop-filter:blur(20px) saturate(140%)}
.tk *,.tk *::before,.tk *::after{box-sizing:border-box}
.tk::-webkit-scrollbar{width:11px;height:11px}
.tk::-webkit-scrollbar-thumb{background:rgba(255,255,255,.13);border:3px solid transparent;border-radius:99px;background-clip:padding-box}
.tk::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.26);background-clip:padding-box}
.tk-head{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:10px;padding:13px 14px 11px;border-bottom:1px solid var(--line);
  background:linear-gradient(180deg,rgba(13,18,22,.97),rgba(13,18,22,.88));backdrop-filter:blur(10px)}
.tk-mark{flex:none;width:22px;height:22px;border-radius:7px;background:linear-gradient(140deg,var(--accent),#38bdf8);box-shadow:0 0 20px -6px var(--accent)}
.tk-id{flex:1;min-width:0}
.tk-tag{font-size:14.5px;font-weight:600;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tk-sub{font-size:10.5px;color:var(--muted);letter-spacing:.02em}
.tk-badge{flex:none;display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:99px;border:1px solid var(--line);background:var(--surf);
  color:var(--muted);font-size:10.5px;letter-spacing:.04em;white-space:nowrap}
.tk-badge::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}
.tk-badge[data-state=hit]{color:var(--accent);border-color:rgba(94,234,212,.34);background:var(--accent-dim)}
.tk-badge[data-state=miss]{color:var(--warn);border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.1)}
.tk-close{flex:none;display:grid;place-items:center;width:26px;height:26px;border-radius:8px;border:1px solid var(--line);background:var(--surf);
  color:var(--muted);font:inherit;font-size:13px;line-height:1;cursor:pointer;transition:background .16s,color .16s,transform .16s}
.tk-close:hover{background:var(--surf2);color:var(--fg);transform:rotate(90deg)}
.tk-body{padding:13px 14px 14px}
.tk-sec{margin-bottom:14px}
.tk-sec>h3{display:flex;align-items:center;gap:9px;margin:0 0 9px;font-size:10.5px;font-weight:600;letter-spacing:.16em;color:var(--muted)}
.tk-sec>h3::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--line2),transparent)}
.tk-card{display:flex;align-items:flex-start;gap:12px;padding:12px 13px;border-radius:12px;border:1px solid var(--line);
  background:linear-gradient(155deg,var(--surf),rgba(255,255,255,.012))}
.tk-card-main{flex:1;min-width:0}
.tk-name{font-size:16px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.tk-alias{margin-top:3px;font-size:11.5px;color:var(--muted);overflow-wrap:anywhere}
.tk-stats{display:flex;gap:16px;margin-top:10px}
.tk-stat{display:flex;flex-direction:column;gap:1px}
.tk-stat>span:first-child{font-size:9.5px;letter-spacing:.1em;color:var(--muted)}
.tk-stat>span:last-child{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.tk-link{flex:none;align-self:center;padding:5px 10px;border-radius:9px;border:1px solid rgba(94,234,212,.28);background:var(--accent-dim);
  color:var(--accent);font-size:11.5px;text-decoration:none;white-space:nowrap;transition:background .16s,border-color .16s}
.tk-link:hover{background:rgba(94,234,212,.2);border-color:rgba(94,234,212,.5)}
.tk-empty{padding:11px 12px;border-radius:10px;border:1px dashed var(--line2);background:rgba(255,255,255,.02);color:var(--muted);font-size:12px}
/* 竖图标准：格子是竖的，图 cover 铺满，不留空白。高度由 aspect-ratio 跟着宽度自己走。 */
.tk-grid{display:grid;gap:8px;margin-top:10px}
.tk-thumb{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;object-position:50% 26%;border-radius:10px;border:1px solid var(--line);
  background:#090d10;cursor:zoom-in;transition:transform .18s cubic-bezier(.2,.8,.3,1),box-shadow .18s,border-color .18s,filter .18s}
.tk-thumb:hover{transform:translateY(-2px) scale(1.012);border-color:var(--line2);box-shadow:0 12px 28px -10px rgba(0,0,0,.8);filter:brightness(1.07)}
.tk-thumb:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tk-skel{aspect-ratio:3/4;border-radius:10px;background:linear-gradient(100deg,rgba(255,255,255,.05),rgba(255,255,255,.13) 45%,rgba(255,255,255,.05) 90%);
  background-size:220% 100%;animation:tk-shimmer 1.15s linear infinite}
@keyframes tk-shimmer{from{background-position:130% 0}to{background-position:-130% 0}}
.tk-pager{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tk-btn{padding:4px 11px;border-radius:9px;border:1px solid var(--line);background:var(--surf);color:var(--fg);font:inherit;font-size:11.5px;
  cursor:pointer;transition:background .16s,border-color .16s,transform .12s}
.tk-btn:hover:not(:disabled){background:var(--surf2);border-color:var(--line2)}
.tk-btn:active:not(:disabled){transform:translateY(1px)}
.tk-btn:disabled{opacity:.32;cursor:default}
.tk-page{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.tk-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}
.tk-size{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);white-space:nowrap}
.tk-size output{min-width:64px;text-align:right;color:var(--fg);font-variant-numeric:tabular-nums}
.tk-range{-webkit-appearance:none;appearance:none;width:112px;height:4px;border-radius:99px;background:linear-gradient(90deg,#2dd4bf,rgba(255,255,255,.14));outline:none}
.tk-range::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#eafffb;border:2px solid var(--accent);
  box-shadow:0 2px 7px rgba(0,0,0,.55);cursor:pointer;transition:transform .15s}
.tk-range::-webkit-slider-thumb:hover{transform:scale(1.18)}
.tk-hint{margin-top:9px;font-size:10.5px;color:var(--muted);letter-spacing:.03em}
.tk-grip{position:absolute;left:0;top:0;z-index:5;width:20px;height:20px;border-radius:16px 0 0 0;cursor:nwse-resize;opacity:.55;
  background:linear-gradient(135deg,rgba(255,255,255,.16),transparent 62%);transition:opacity .16s}
.tk-grip::after{content:'';position:absolute;left:5px;top:5px;width:8px;height:8px;border-left:1.5px solid rgba(255,255,255,.6);
  border-top:1.5px solid rgba(255,255,255,.6);border-radius:3px 0 0 0}
.tk-grip:hover{opacity:1}
:host(.tk-viewer){position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(4,6,8,.9);
  backdrop-filter:blur(16px) saturate(120%);cursor:zoom-out;animation:tk-fade .16s ease}
:host(.tk-viewer) img{max-width:94vw;max-height:86vh;object-fit:contain;border-radius:12px;border:1px solid rgba(255,255,255,.14);
  background:#090d10;box-shadow:0 40px 110px -24px #000;cursor:default}
:host(.tk-viewer) .tk-note{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);color:rgba(255,255,255,.6);letter-spacing:.05em;
  font:11px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
@keyframes tk-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.tk *,:host(.tk-viewer),:host(.tk-viewer) *{animation:none!important;transition:none!important}}
`;

  /* 每个浮层各挂一份样式表到自己的 shadow root：站点的 CSS 进不来，我们的也漏不出去。 */
  const shell = host => {
    const root = host.attachShadow?.({ mode: 'open' }) || host;
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);
    return root;
  };

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

  /* 缩略图尺寸：滑杆调的是格子宽度，高度由 CSS 的 aspect-ratio 按 3:4 自己跟随，
     所以这里只需要把列宽写回去——不用再逐个 img 改高度。 */
  let cellWidth = 180;
  const cellHeight = () => Math.round(cellWidth * 4 / 3);
  const columns = () => `repeat(auto-fill,minmax(${cellWidth}px,1fr))`;
  const gridStyle = () => ` style="grid-template-columns:${columns()}"`;
  const row = items => `<div class="tk-grid"${gridStyle()}>`
    + items.map(item => `<img class="tk-thumb" src="${esc(item.thumb)}" alt="" loading="lazy" title="点击看原图"`
      + (item.uid != null ? ` data-uid="${esc(item.uid)}" data-index="${esc(item.index)}"` : ` data-large="${esc(item.large || item.thumb)}"`) + `>`).join('')
    + `</div>`;

  /* 二级界面：只装一张原图，铺满视口。点图片以外的任何地方都关掉；
     图片本身吃掉点击，免得在图上松手也关。Esc 由下面的 keydown 统一处理。 */
  const showViewer = src => {
    closeViewer();
    const host = document.createElement('div');
    host.id = VIEWER_ID;
    host.className = VIEWER_CLASS;
    const root = shell(host);
    const image = document.createElement('img');
    image.src = src;
    image.alt = '';
    image.addEventListener('click', event => event.stopPropagation());
    const note = document.createElement('div');
    note.className = 'tk-note';
    note.textContent = '点击图片以外任何位置，或按 Esc 关闭';
    root.append(image, note);
    host.addEventListener('click', closeViewer);
    document.documentElement.append(host);
  };

  const head = (tag, state, badge) => `<div class="tk-head">`
    + `<div class="tk-mark"></div>`
    + `<div class="tk-id"><div class="tk-tag" title="${esc(tag)}">${esc(tag)}</div><div class="tk-sub">双击提示词，查本机画师库</div></div>`
    + `<span class="tk-badge" data-state="${state}">${badge}</span>`
    + `<button class="tk-close" data-close title="关闭（Esc）">✕</button>`
    + `</div>`;

  const render = async (tag, page = 1) => {
    close();
    closeViewer();
    const layout = await loadLayout();
    if (Number.isFinite(layout.cell)) cellWidth = Math.max(120, Math.min(420, layout.cell));
    const host = document.createElement('div');
    host.id = HOST_ID;
    /* 位置固定右下角，不再让用户拖；只记住尺寸。窗口默认给得偏高一点，竖图格子更舒展。 */
    const width = Math.max(320, Math.min(Number(layout.width) || 640, Math.round(innerWidth * 0.94)));
    const height = Math.max(240, Math.min(Number(layout.height) || 560, Math.round(innerHeight * 0.9)));
    Object.assign(host.style, { position: 'fixed', right: '24px', bottom: '24px', width: width + 'px', height: height + 'px', zIndex: '2147483647' });
    const root = shell(host);
    const box = document.createElement('div');
    box.className = 'tk';
    box.innerHTML = head(tag, '', '查询中')
      + `<div class="tk-body"><div class="tk-grid"${gridStyle()}>` + '<div class="tk-skel"></div>'.repeat(8) + `</div></div>`;
    box.addEventListener('dblclick', event => event.stopPropagation());
    root.append(box);
    document.documentElement.append(host);

    /* 左上角的缩放手柄：往左上拖变大。面板是 right/bottom 定位，
       所以只改宽高就会自然向左上生长，右下角锚点不动。 */
    const grip = document.createElement('div');
    grip.className = 'tk-grip';
    grip.title = '拖动调整大小';
    grip.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX, startY = event.clientY, startWidth = host.offsetWidth, startHeight = host.offsetHeight;
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
      if (event.target?.closest?.('[data-close]')) { close(); return; }
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
      ? `<div class="tk-card"><div class="tk-card-main">`
        + `<div class="tk-name">${esc(hit.artist.name)}</div>`
        + `<div class="tk-alias">${esc([hit.artist.alias, hit.artist.category].filter(Boolean).join(' · ')) || '未记录别称 / 分类'}</div>`
        + `<div class="tk-stats"><div class="tk-stat"><span>作品数量</span><span>${esc(countText(hit.artist))}</span></div></div>`
        + `</div>`
        + (hit.artist.url ? `<a class="tk-link" href="${esc(hit.artist.url)}" target="_blank" rel="noopener">在库中打开</a>` : '')
        + `</div>`
        + (hit.thumbs?.length ? row(hit.thumbs.map((src, index) => ({ thumb: src, uid: hit.artist.uid, index }))) : `<div class="tk-empty">这位画师库里还没有缩略图</div>`)
      : `<div class="tk-empty">本机画师库里没有「${esc(tag)}」——下面看看 Danbooru 的搜索结果</div>`;
    box.innerHTML = head(tag, hit?.ok ? 'hit' : 'miss', hit?.ok ? '库内命中' : '库内未命中')
      + `<div class="tk-body">`
      + `<div class="tk-sec"><h3>本机画师库</h3>${library}</div>`
      + `<div class="tk-sec" data-remote></div>`
      + `<div class="tk-foot">`
      + `<a class="tk-link" href="${LARGE_URL}${encodeURIComponent(tag)}" target="_blank" rel="noopener">在 Danbooru 打开 ↗</a>`
      + `<label class="tk-size">缩略图 <input class="tk-range" type="range" min="120" max="420" step="10" value="${cellWidth}" title="调整缩略图大小（宽高按竖图比例一起变）"><output data-size>${cellWidth}×${cellHeight()}</output></label>`
      + `</div>`
      + `<div class="tk-hint">双击别处、按 Esc 或点面板外关闭</div>`
      + `</div>`;

    /* 只重画 Danbooru 那一段：翻页时标题、库内一行、底部控件都不动。 */
    const paintRemote = (posts, at) => {
      const holder = box.querySelector('[data-remote]');
      if (!holder) return;
      holder.innerHTML = `<h3>Danbooru · 第 ${at} 页</h3>`
        + `<div class="tk-pager">`
        + `<button class="tk-btn" data-page="${at - 1}" ${at <= 1 ? 'disabled' : ''}>‹ 上一页</button>`
        + `<button class="tk-btn" data-page="${at + 1}" ${posts.length ? '' : 'disabled'}>下一页 ›</button>`
        + `<span class="tk-page">本页 ${posts.length} 张</span>`
        + `</div>`
        + (posts.length ? row(posts) : `<div class="tk-empty" style="margin-top:10px">站点这一页没有返回图片</div>`);
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
      cellWidth = Number(slider.value) || 180;
      const label = box.querySelector('[data-size]');
      if (label) label.textContent = cellWidth + '×' + cellHeight();
      /* 只改列宽：高度交给 aspect-ratio 跟随，所以缩略图不用逐个重画。 */
      box.querySelectorAll('.tk-grid').forEach(grid => { grid.style.gridTemplateColumns = columns(); });
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
