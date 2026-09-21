/* takoma 提示词助手（实验性）：在提示词界面里双击一个提示词，先查本机画师库，
   命中就把画师卡片浮出来（文字 + 最多 5 张库内预览）；没命中就给一条 Danbooru 搜索链接。
   只在 staging.takoma.app 注入（manifest 里限定），改坏了不影响别处。

   两个刻意的选择：
   1. 不用 getSelection().toString() —— 浏览器原生双击遇到空格就断，双击 long hair 只会给到 long。
      所以拿「整段文本 + 选区起点」，交给 prompt-tag.mjs 切出完整那一段。
   2. 标签的切片规则与「空格换下划线」都是 import 进来的：被单测覆盖的就是这里跑的那一份，
      不复制一遍，免得两边慢慢长歪。 */
(() => {
  const HOST_ID = 'artist-library-prompt-helper';
  const SEPARATOR = /[,，;；|\n\r]/;
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
    const prefix = node.textContent?.slice(0, selection.anchorOffset) ?? '';
    return { text, offset: Math.max(0, text.indexOf(prefix) + prefix.length) };
  };
  const close = () => document.getElementById(HOST_ID)?.remove();
  const render = async tag => {
    close();
    const host = document.createElement('div');
    host.id = HOST_ID;
    Object.assign(host.style, { position: 'fixed', right: '24px', bottom: '24px', zIndex: '2147483647' });
    const root = host.attachShadow?.({ mode: 'open' }) || host;
    /* 宽度跟着画布走（takoma 的画布是 .tkCanvasPane），量不到就 480 兜底，再夹进视口。
       图放大到 150px 高、4 列——浮窗本来就是用来看图的，不是看字的。 */
    const paneWidth = Math.round(document.querySelector('.tkCanvasPane')?.getBoundingClientRect?.().width || 0);
    const width = Math.max(360, Math.min(paneWidth || 480, Math.round(innerWidth * 0.9)));
    const box = document.createElement('div');
    Object.assign(box.style, { width: width + 'px', maxHeight: '70vh', overflow: 'auto', background: '#1b2224', color: '#e9efee', border: '1px solid #364346', borderRadius: '12px', boxShadow: '0 16px 50px #0008', font: '13px/1.6 "Segoe UI","Microsoft YaHei",sans-serif', padding: '12px' });
    box.textContent = `正在查「${tag}」…`;
    box.addEventListener('dblclick', event => event.stopPropagation());
    root.append(box);
    document.documentElement.append(host);
    let result = null;
    try { result = await chrome.runtime.sendMessage({ type: 'takoma.lookup', tag }); }
    catch (error) { result = { ok: false, reason: '扩展没有回应：' + (error?.message || error) }; }
    if (document.getElementById(HOST_ID) !== host) return; /* 期间又双击了别的标签，这条结果作废 */
    const line = (label, value) => (value ? `<div style="color:#abbcb9">${label} <span style="color:#e9efee">${value}</span></div>` : '');
    if (result?.ok) {
      const a = result.artist || {};
      const counts = a.total == null ? '未读取' : a.total + (a.beforeTotal == null ? '' : `（${a.beforeTotal}）`);
      box.innerHTML = `<div style="font-size:15px;font-weight:600">${a.name || ''}</div>`
        + line('笔名', a.alias) + line('分类', a.category) + line('作品数量', counts)
        + (result.thumbs?.length ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px">${result.thumbs.map(src => `<img src="${src}" style="width:100%;height:72px;object-fit:contain;background:#141b1d;border:1px solid #2a3538;border-radius:6px">`).join('')}</div>` : '')
        + `<div style="color:#8d9e9c;font-size:11px;margin-top:8px">来自本机画师库 · 双击别处关闭</div>`;
    } else if (result?.reason === 'no-library') {
      box.innerHTML = `<div>「${tag}」需要画师库来查</div><div style="color:#abbcb9;margin-top:6px">先把画师库页面打开（数据在你的文件夹里，只有那个页面读得到），再回来双击。</div>`;
    } else {
      /* 库里没有 → 交给 Danbooru：先拿前 8 条渲染缩略图，拿不到就退回一条能点的搜索链接，
         别让这次双击落空。图片地址直接用站点的 preview_file_url（跨站请求由 background 代发）。 */
      const url = 'https://danbooru.donmai.us/posts?tags=' + encodeURIComponent(tag);
      let posts = [];
      try { const found = await chrome.runtime.sendMessage({ type: 'takoma.danbooru', tag }); if (found?.ok) posts = found.posts || []; } catch {}
      if (document.getElementById(HOST_ID) !== host) return; /* 期间又双击了别的标签，这条结果作废 */
      box.innerHTML = `<div>库里没有「${tag}」</div>`
        + (posts.length ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px">${posts.map(post => `<img src="${post.thumb}" alt="" style="width:100%;height:64px;object-fit:contain;background:#141b1d;border:1px solid #2a3538;border-radius:6px">`).join('')}</div>` : '')
        + `<a href="${url}" target="_blank" rel="noopener" style="color:#a5dfcc;display:inline-block;margin-top:8px">在 Danbooru 搜索「${tag}」 →</a>`;
    }
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
