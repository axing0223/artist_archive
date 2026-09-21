/* takoma 提示词助手（实验性）：在提示词界面里双击一个提示词，先查本机画师库，
   命中就把画师卡片浮出来（文字 + 最多 5 张库内预览）；没命中就给 Danbooru 的搜索结果，
   并给一个「添加至画师库」的按钮。只在 staging.takoma.app 注入（manifest 里限定）。

   几个刻意的选择：
   1. 不用 getSelection().toString() —— 浏览器原生双击遇到空格就断，双击 long hair 只会给到 long。
      所以拿「容器 + 落点」，交给 prompt-tag.mjs 按块级边界切出完整那一段。
   2. 标签的切片规则、空格换下划线、权重剥壳都是 import 进来的：被单测覆盖的就是这里跑的那一份。
   3. 浮窗位置固定右下角，只允许在左上角拖手柄改尺寸（用户明确不要自由拖动）。
      面板是 right/bottom 定位，所以往左上拖变大会自然向左上生长，右下的锚点不动。
   4. 翻页只重画 Danbooru 那一段：它有独立的容器，标题、库内一行、底部控件都不动。
   5. 点缩略图弹二级界面看原图，点图片以外任何地方或按 Esc 关闭。
   6. 表现层：面板和二级界面各自把一份样式表挂进自己的 shadow root（既不读站点 CSS，
      也不会漏出去污染站点）。面板是「头 + 可滚动内容 + 固定底栏」的三段竖排，
      所以底部控件和提示常驻最下方，不跟着内容滚走。
   7. 缩略图以**竖图**为标准：格子本身就是 3:4 的竖格，图片 cover 铺满不留空白；
      横图会被裁掉上下，要看不裁的原图就点开二级界面。改格子宽度时高度靠 aspect-ratio 自动跟随。
   8. 关闭浮窗是把 lastTag 一起清掉的：关掉之后再双击同一个词必须能重新弹出来。
      （内部换标签重渲染走 removePanel，不清 lastTag，那是另一回事。） */
(() => {
  const HOST_ID = 'artist-library-prompt-helper';
  const VIEWER_ID = 'artist-library-prompt-helper-viewer';
  const VIEWER_CLASS = 'tk-viewer';
  const LAYOUT_KEY = 'takoma-helper.layout';
  const LARGE_URL = 'https://danbooru.donmai.us/posts?tags=';
  const VIEWER_HINT = '点击图片以外任何位置，或按 Esc 关闭';
  let lastTag = '';

  /* 用户主动关闭 = 也允许同一个词再弹一次；渲染内部换标签用 removePanel，不动 lastTag。 */
  const canAnimate = () => { try { return !matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; } };
  /* 淡出：先摘掉 id 再播动画，最后才 remove。这一步是有意的——
     getElementById 是「这个面板还是不是当前那一个」的唯一判据（陈旧结果作废、Esc 该关谁、
     点面板外都靠它）。要是让正在淡出的那个继续占着 id，迟到的查询结果就会认错面板。 */
  const fadeOut = (host, ms) => {
    if (!host) return;
    host.removeAttribute('id');
    if (!canAnimate()) { host.remove(); return; }
    host.classList.add('tk-leaving');
    setTimeout(() => host.remove(), ms);
  };
  const removePanel = (animate = false) => { const host = document.getElementById(HOST_ID); animate ? fadeOut(host, 220) : host?.remove(); };
  const close = () => { lastTag = ''; removePanel(true); };
  const closeViewer = (animate = false) => { const host = document.getElementById(VIEWER_ID); animate ? fadeOut(host, 200) : host?.remove(); };
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
  position:relative;display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;overflow:hidden;border-radius:16px;
  background:linear-gradient(168deg,#161d22,#0c1114 72%);border:1px solid var(--line2);color:var(--fg);text-align:left;
  font:13px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  box-shadow:0 30px 80px -22px rgba(0,0,0,.85),0 0 0 1px rgba(0,0,0,.45);backdrop-filter:blur(20px) saturate(140%)}
.tk *,.tk *::before,.tk *::after{box-sizing:border-box}
.tk-head{flex:none;display:flex;align-items:center;gap:10px;padding:13px 14px 11px;border-bottom:1px solid var(--line);
  background:linear-gradient(180deg,rgba(15,20,25,.96),rgba(13,18,22,.72))}
.tk-mark{flex:none;width:22px;height:22px;border-radius:7px;background:linear-gradient(140deg,var(--accent),#38bdf8) center/cover no-repeat;box-shadow:0 0 20px -6px var(--accent)}
/* 有应用图标就用它（URL 由 shell() 注入；取不到时保持上面的渐变色块）。 */
.tk-mark[data-logo]{background-image:url(__TK_LOGO__);box-shadow:none}
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
/* 中间这段是唯一会滚动的区域，头尾都常驻。 */
.tk-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:13px 14px}
.tk-body::-webkit-scrollbar{width:11px;height:11px}
.tk-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.13);border:3px solid transparent;border-radius:99px;background-clip:padding-box}
.tk-body::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.26);background-clip:padding-box}
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
.tk-empty{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 12px;border-radius:10px;border:1px dashed var(--line2);
  background:rgba(255,255,255,.02);color:var(--muted);font-size:12px}
.tk-add{flex:none;padding:5px 11px;border-radius:9px;border:1px solid rgba(94,234,212,.34);background:var(--accent-dim);color:var(--accent);
  font:inherit;font-size:11.5px;cursor:pointer;transition:background .16s,border-color .16s,transform .12s}
.tk-add:hover:not(:disabled){background:rgba(94,234,212,.2);border-color:rgba(94,234,212,.55)}
.tk-add:active:not(:disabled){transform:translateY(1px)}
.tk-add:disabled{opacity:.62;cursor:default}
.tk-add-note{font-size:11px}
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
/* 底栏和提示常驻面板最下方：不跟着内容滚。 */
.tk-foot-wrap{flex:none;padding:11px 14px 12px;border-top:1px solid var(--line);background:linear-gradient(0deg,rgba(11,15,19,.98),rgba(13,18,22,.9))}
.tk-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.tk-size{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);white-space:nowrap}
.tk-size output{min-width:64px;text-align:right;color:var(--fg);font-variant-numeric:tabular-nums}
.tk-range{-webkit-appearance:none;appearance:none;width:112px;height:4px;border-radius:99px;background:linear-gradient(90deg,#2dd4bf,rgba(255,255,255,.14));outline:none}
.tk-range::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#eafffb;border:2px solid var(--accent);
  box-shadow:0 2px 7px rgba(0,0,0,.55);cursor:pointer;transition:transform .15s}
.tk-range::-webkit-slider-thumb:hover{transform:scale(1.18)}
.tk-hint{margin-top:8px;font-size:10.5px;color:var(--muted);letter-spacing:.03em}
.tk-key{display:inline-block;padding:0 5px;margin:0 1px;border-radius:5px;border:1px solid var(--line2);background:rgba(255,255,255,.05);
  color:var(--fg);font-size:10px;line-height:16px;font-variant-numeric:tabular-nums}
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
/* 动态过渡：面板弹出/关闭、原图打开/关闭、换页时作品的进场，都走这几支。
   「关闭」那几支能看得见，是因为 JS 里 fadeOut 先摘掉 id 再等动画播完才 remove——
   动画只是表现，身份判断在摘 id 那一刻就已经生效了，不会因为动画拖着而认错面板。 */
@keyframes tk-panel-in{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
@keyframes tk-panel-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(10px) scale(.985)}}
@keyframes tk-body-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes tk-thumb-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
@keyframes tk-pop{0%{opacity:0;transform:scale(.86)}60%{transform:scale(1.04)}100%{opacity:1;transform:none}}
@keyframes tk-viewer-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
/* 关闭只做纯渐变：不缩放、不位移。整块遮罩连图一起淡走，不给原图加额外动作。 */
@keyframes tk-viewer-out{from{opacity:1}to{opacity:0}}
.tk{animation:tk-panel-in .24s cubic-bezier(.2,.9,.25,1)}
.tk-body{animation:tk-body-in .22s ease}
.tk-badge{animation:tk-pop .3s cubic-bezier(.2,.9,.25,1)}
.tk-card{animation:tk-body-in .24s ease}
/* 缩略图逐张进场；每张的延迟由 JS 按序号写在行内 animation-delay 上。 */
.tk-thumb{animation:tk-thumb-in .32s cubic-bezier(.2,.9,.25,1) backwards}
:host(.tk-leaving){pointer-events:none}
:host(.tk-leaving) .tk{animation:tk-panel-out .2s ease forwards}
:host(.tk-viewer) img{animation:tk-viewer-in .22s cubic-bezier(.2,.9,.25,1)}
:host(.tk-viewer.tk-leaving){animation:tk-viewer-out .18s ease forwards;pointer-events:none}
@media (prefers-reduced-motion:reduce){.tk,.tk *,:host(.tk-viewer),:host(.tk-viewer) *{animation:none!important;transition:none!important}}
`;

  /* 每个浮层各挂一份样式表到自己的 shadow root：站点的 CSS 进不来，我们的也漏不出去。
     左上角那块标记用扩展的应用图标——它在 web_accessible_resources 里放行过，内容脚本才取得到；
     取不到（扩展刚被重载、上下文失效）就退回样式表里的渐变色块。 */
  const logoUrl = (() => { try { return chrome.runtime.getURL('icons/icon128.png'); } catch { return ''; } })();
  const shell = host => {
    const root = host.attachShadow?.({ mode: 'open' }) || host;
    const style = document.createElement('style');
    style.textContent = CSS.replace(/__TK_LOGO__/g, logoUrl || 'none');
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
    + items.map((item, index) => `<img class="tk-thumb" style="animation-delay:${Math.min(index, 11) * 24}ms" src="${esc(item.thumb)}" alt="" loading="lazy" title="点击看原图"`
      + (item.uid != null ? ` data-uid="${esc(item.uid)}" data-index="${esc(item.index)}"` : ` data-large="${esc(item.large || item.thumb)}"`) + `>`).join('')
    + `</div>`;

  /* 二级界面：只装一张原图，铺满视口。点图片以外的任何地方都关掉；
     图片本身吃掉点击，免得在图上松手也关。Esc 由下面的 keydown 统一处理。
     返回两个"迟到也能安全调用"的方法：界面先开、原图后到（见下面点缩略图那段），
     而用户可能在原图回来之前就把它关掉了、或者又点开了别的图——两个方法都先确认
     「我这一份还是当前那一个二级界面」再动手，免得迟到的结果写进一个已经作废的界面。 */
  const showViewer = (src, noteText = VIEWER_HINT) => {
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
    note.textContent = noteText;
    root.append(image, note);
    host.addEventListener('click', () => closeViewer(true));
    document.documentElement.append(host);
    const alive = () => document.getElementById(VIEWER_ID) === host;
    return {
      setSource: url => { if (alive()) image.src = url; },
      setNote: text => { if (alive()) note.textContent = text; },
    };
  };

  const head = (tag, state, badge) => `<div class="tk-head">`
    + `<div class="tk-mark" data-logo></div>`
    + `<div class="tk-id"><div class="tk-tag" title="${esc(tag)}">${esc(tag)}</div><div class="tk-sub">双击提示词，查本机画师库</div></div>`
    + `<span class="tk-badge" data-state="${state}">${badge}</span>`
    + `<button class="tk-close" data-close title="关闭（Esc）">✕</button>`
    + `</div>`;

  const render = async (tag, page = 1) => {
    removePanel();
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

    /* 库里没这个标签时，把这段文字交给画师库页面建卡（复用右键菜单那条通道：
       画师库开着就直接建，没开着就排待办 + 打开页面，页面加载后自己领）。
       按钮自己显示结果，所以这里用面板里的按钮状态回报，而不是另开提示。 */
    const addArtist = async button => {
      button.disabled = true;
      button.textContent = '正在添加…';
      const note = box.querySelector('[data-add-note]');
      const answer = await ask('takoma.add-artist', tag);
      if (document.getElementById(HOST_ID) !== host) return; /* 面板已经关了，别去改它 */
      if (answer?.ok && answer.queued) {
        button.textContent = '已排进画师库待办';
        if (note) note.textContent = '画师库页面正在打开，它会自己把这张卡建好';
      } else if (answer?.ok) {
        button.textContent = '已添加' + (answer.name ? '：' + answer.name : '');
        if (note) note.textContent = answer.works ? `补到了 ${answer.works} 张作品` : '卡片已建立，资料可以在画师库里补全';
      } else {
        button.disabled = false;
        button.textContent = '再试一次';
        if (note) note.textContent = answer?.reason === 'no-library' ? '画师库页面没打开' : (answer?.reason || '画师库没有回应');
      }
    };

    /* 打开画师库：用户主动点了按钮，这时候开页面/切前台是应该的（和点漂浮提示同一套逻辑）。 */
    const openLibrary = async button => {
      button.disabled = true;
      button.textContent = '正在打开…';
      const note = box.querySelector('[data-open-note]');
      const answer = await ask('takoma.open-library', tag);
      if (document.getElementById(HOST_ID) !== host) return; /* 面板已经关了，别去改它 */
      if (answer?.ok) {
        button.textContent = '已打开';
        if (note) note.textContent = '等它加载完，再双击一次这个提示词就能查到';
      } else {
        button.disabled = false;
        button.textContent = '再试一次';
        if (note) note.textContent = answer?.reason || '没能打开画师库';
      }
    };

    /* 点缩略图 → 二级界面。库内的图带 uid/index，点开时才去要原图（懒加载，
       查询时把 5 张原图 base64 一起塞进消息太重）；站点那侧的图直接用它给的 file_url。 */
    box.addEventListener('click', async event => {
      if (event.target?.closest?.('[data-close]')) { close(); return; }
      const addButton = event.target?.closest?.('[data-add]');
      if (addButton) { addArtist(addButton); return; }
      const openButton = event.target?.closest?.('[data-open-library]');
      if (openButton) { openLibrary(openButton); return; }
      const image = event.target?.closest?.('img[src]');
      if (!image) return;
      /* 先开界面、再加载原图，和站点那边的图保持一致：站点的 data-large 本来就是原图地址，
         交给浏览器自己边下边显示；库内的图要现从磁盘读，那就先用缩略图占位把界面开出来，
         读到原图再换上去——不然点了要干等，两边手感不一样。 */
      const viewer = showViewer(image.dataset.large || image.src);
      if (image.dataset.uid == null) return;
      viewer.setNote('正在读取原图…');
      let big = null;
      try { big = await chrome.runtime.sendMessage({ type: 'takoma.lookup-large', uid: image.dataset.uid, index: Number(image.dataset.index) || 0 }); } catch {}
      if (big?.ok && big.url) { viewer.setSource(big.url); viewer.setNote(VIEWER_HINT); }
      else viewer.setNote('原图没读出来，先看缩略图');
    });

    const [hit, remote] = await Promise.all([ask('takoma.lookup', tag), ask('takoma.danbooru', tag, page)]);
    if (document.getElementById(HOST_ID) !== host) return; /* 期间又双击了别的标签，这条结果作废 */
    if (remote?.ok && Number(remote.page) > 0) page = Number(remote.page);

    const countText = artist => artist.total == null ? '未读取' : artist.total + (artist.beforeTotal == null ? '' : `（${artist.beforeTotal}）`);
    /* 画师库页面没开着时后台回的是 reason:'no-library'——这时「库内未命中」和「添加至画师库」
       都是错的：库根本没查过，而且建卡必须由那个页面完成。改成给一个「打开画师库」的按钮，
       点了让后台把页面开出来（用户主动点，开页面是应该的）。 */
    const noLibrary = hit?.reason === 'no-library';
    const library = hit?.ok
      ? `<div class="tk-card"><div class="tk-card-main">`
        + `<div class="tk-name">${esc(hit.artist.name)}</div>`
        + `<div class="tk-alias">${esc([hit.artist.alias, hit.artist.category].filter(Boolean).join(' · ')) || '未记录别称 / 分类'}</div>`
        + `<div class="tk-stats"><div class="tk-stat"><span>作品数量</span><span>${esc(countText(hit.artist))}</span></div></div>`
        + `</div>`
        + (hit.artist.url ? `<a class="tk-link" href="${esc(hit.artist.url)}" target="_blank" rel="noopener">在库中打开</a>` : '')
        + `</div>`
        + (hit.thumbs?.length ? row(hit.thumbs.map((src, index) => ({ thumb: src, uid: hit.artist.uid, index }))) : `<div class="tk-empty" style="margin-top:10px">这位画师库里还没有缩略图</div>`)
      : noLibrary
        ? `<div class="tk-empty"><span>画师库页面没有打开，本机库里有没有这位画师暂时查不到。</span>`
          + `<button class="tk-add" data-open-library>打开画师库</button>`
          + `<span class="tk-add-note" data-open-note></span></div>`
        /* 真的查过、库里没有：句子末尾直接跟一个「添加至画师库」，点了就把这个标签收进库里。 */
        : `<div class="tk-empty"><span>本机画师库里没有「${esc(tag)}」——下面看看 Danbooru 的搜索结果</span>`
          + `<button class="tk-add" data-add>添加至画师库</button>`
          + `<span class="tk-add-note" data-add-note></span></div>`;
    box.innerHTML = head(tag, hit?.ok ? 'hit' : (noLibrary ? '' : 'miss'), hit?.ok ? '库内命中' : (noLibrary ? '画师库未打开' : '库内未命中'))
      + `<div class="tk-body">`
      + `<div class="tk-sec"><h3>本机画师库</h3>${library}</div>`
      + `<div class="tk-sec" data-remote style="margin-bottom:0"></div>`
      + `</div>`
      + `<div class="tk-foot-wrap">`
      + `<div class="tk-foot">`
      + `<a class="tk-link" href="${LARGE_URL}${encodeURIComponent(tag)}" target="_blank" rel="noopener">在 Danbooru 打开 ↗</a>`
      + `<label class="tk-size">缩略图 <input class="tk-range" type="range" min="120" max="420" step="10" value="${cellWidth}" title="调整缩略图大小（宽高按竖图比例一起变）"><output data-size>${cellWidth}×${cellHeight()}</output></label>`
      + `</div>`
      + `<div class="tk-hint">双击别处、按 <span class="tk-key">Esc</span> 或点面板外关闭 · 翻页 <span class="tk-key">a</span><span class="tk-key">d</span> / <span class="tk-key">←</span><span class="tk-key">→</span></div>`
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
        /* 换页先在这一格铺骨架屏：等待期间有东西在动，高度也不跳；回来时缩略图再逐张进场。 */
        const grid = holder.querySelector('.tk-grid');
        if (grid) grid.innerHTML = '<div class="tk-skel"></div>'.repeat(10);
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
    if (!tag || tag === lastTag) return; /* 面板已经开着同一个词，不用重查；关掉后 lastTag 会被清掉 */
    lastTag = tag;
    render(tag);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (document.getElementById(VIEWER_ID)) closeViewer(true); /* 先关二级界面，再关面板 */
      else close();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const panel = document.getElementById(HOST_ID);
    if (!panel || document.getElementById(VIEWER_ID)) return; /* 看原图时翻页没意义 */
    /* 焦点在滑杆上时左右键归滑杆。事件从 shadow 里冒出来会被重定向到宿主元素，
       所以要用 composedPath 拿到真正挨按键的那个元素。 */
    const inner = event.composedPath?.()[0];
    if (inner?.closest?.('.tk-range')) return;
    const step = event.key === 'a' || event.key === 'ArrowLeft' ? -1 : (event.key === 'd' || event.key === 'ArrowRight' ? 1 : 0);
    if (!step) return;
    const buttons = (panel.shadowRoot || panel).querySelectorAll?.('[data-remote] button[data-page]');
    const button = buttons?.[step < 0 ? 0 : 1];
    if (!button || button.disabled) return;
    event.preventDefault(); /* 别让 a/d 落进提示词输入框，也别让方向键滚页面 */
    button.click();
  }, true);
  document.addEventListener('click', event => {
    if (document.getElementById(VIEWER_ID)) return; /* 二级界面自己处理关闭 */
    if (!event.target?.closest?.(`#${HOST_ID}`)) close();
  }, true);
})();
