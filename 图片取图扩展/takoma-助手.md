# takoma 提示词助手（实验性）

在 `https://staging.takoma.app/image/` 上双击一个提示词 → 先查本机画师库，命中就浮出画师卡片；
没命中就用这个提示词去 Danbooru 搜图显示。

## 已确认的产品决策

| 问题 | 决定 |
|---|---|
| 画师库页面没开着怎么办 | **只查已经开着的**，没开就在浮窗里提示，不自动开标签页 |
| 命中时显示什么 | 文字（名字/分类/数量）+ 最多 5 张库内预览缩略图 |
| 没命中时显示什么 | Danbooru 前 8 张缩略图 + 一个「在 Danbooru 打开」链接 |

## 硬约束（决定了整个链路）

库数据在你选的文件夹里，走 File System Access API —— **只有画师库页面**握着文件夹句柄，
扩展的 background 和 takoma 页面都读不到。所以：

```
takoma 页面（双击）
  → content script：取完整提示词、空格换 _ 
  → background：转发（只找已经开着的画师库页面）
  → 画师库页面（它有句柄）：查库 → 返回卡片数据
  → content script：渲染漂浮窗
```

## 已完成

**`图片取图扩展/prompt-tag.mjs`** + `prompt-tag.test.mjs`（6 条单测，已进 `package.json` 的 test 列表）：

- `pickPromptTag(text, offset)` —— 按逗号/分号/竖线/换行切段，取落点所在的**那一整段**。
  不能直接用 `getSelection()`：浏览器原生双击遇空格就断，双击 `long hair` 只会给到 `long`。
- `normalizePromptTag(value)` —— 两头空白与残留分隔符去掉，内部连续空白（含全角）收成 `_`，
  `(tag:1.2)` / `[tag]` / `{tag}` 只取标签本身。
- `promptTagAt(text, offset)` —— 上面两步合并。

## 剩余步骤

1. **manifest**：加 content script，`matches: ["https://staging.takoma.app/*"]`，`run_at: document_idle`；
   并把 `prompt-tag.mjs` 加进 `web_accessible_resources`（content script 用它动态 import，
   保持"被测试的逻辑"和"上线的逻辑"是同一份，不要复制一份进 content script）。
2. **`图片取图扩展/takoma.js`**（新文件，参照 `toast.js` 的单例 + Shadow DOM 写法）：
   - `dblclick` → 取提示词输入框的**全文**与选区的 `anchorOffset` → 动态 import prompt-tag.mjs →
     `promptTagAt(text, offset)`；
   - 发 `{type:'takoma.lookup', tag}`；
   - 渲染浮窗：命中显示文字 + 缩略图；`reason:'no-library'` 提示「先打开画师库」；
     `not-found` 走 Danbooru 分支；再点一次或按 Esc 关闭（同一个浮窗单例，别叠出多个）。
3. **background**：加 `takoma.lookup` 转发。用现成的 `findLibraryTab()`（它**不会**创建标签页，
   正合决策）；拿不到就回 `{ok:false,reason:'no-library'}`。只接受来自自己扩展的 sender。
   Danbooru 分支同样走背景（`probe.mjs` 里的 `fetchApi`）绕开 CORS；content script 不直连。
4. **画师库侧只读入口**（`app/app.js`，绑消息的地方）：按标签查库并回一个紧凑 payload。
   - 查询复用 `libraryIndex.select(data.artists,{query:tag})`（和站内搜索同一套：名字/笔名/别名/标签）；
     把 `_` 归一成空格再比一遍精确命中，命中优先，否则取第一条。
   - 缩略图取 `FolderStore.previewWorks(artist, PREVIEW_SLOTS, reservedOf())` 的至多 5 张，
     用 `ArtistImages.dataUrl(...)` 转成 data URL（**先读准它的真实签名**，别照猜）。
   - 只读：不改库、不改界面、不写盘；查的是当前这份内存快照。
5. **测试**：单测覆盖第 4 步 payload 的形状（在 app-smoke 的假 DOM 里调）；
   浏览器回归加一条浮窗渲染断言。纯函数那部分已经测过了。

## 注意事项

- 扩展改完要在 `chrome://extensions` 重新加载才生效。
- 实验性：只在 `staging.takoma.app` 注入，改坏了不影响本站。
- `prompt-tag.mjs` 一旦改了，跑 `npm test` 会连带覆盖到注入脚本用的那份逻辑。

## 边界：这块功能只碰了这些地方（可整体摘掉）

按用户要求，这块功能不掺进插件原有流程。要停掉或卸载时照下表逐个还原即可，
每一处源码里都带「takoma」字样，直接搜这个词就能找齐：

| 文件 | 改动 |
|---|---|
| `manifest.json` | `content_scripts` 多一条（只匹配 `staging.takoma.app`）；`web_accessible_resources` 一条 |
| `takoma.js` | 整个文件（内容脚本） |
| `prompt-tag.mjs` | 整个文件（纯函数，被内容脚本动态 import） |
| `prompt-tag.test.mjs` + `package.json` 的 test 列表 | 那 7 条单测与列表里的文件名 |
| `background.js` | 两个独立监听器：`takoma.lookup`、`takoma.danbooru` |
| `app/app.js` | `normalizeForLookup` / `namesForLookup` / `lookupForPrompt` / `window.ArtistPromptLookup`，以及 `bindExtensionMessages` 里一条 `artist-library.lookup` 分支 |

没有改动任何既有代码路径：两个 background 监听器只认自己的消息类型、并校验 sender 是自己扩展；
app.js 那条分支只认 `artist-library.lookup`，碰不到原有的 create / focus / 取图流程。
`npm test` 里既有 316 条断言全绿，就是这条边界的证据。
