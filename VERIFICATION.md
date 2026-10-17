# 验收记录

Shelf，文件夹即素材库的桌面原型。运行环境 macOS arm64，10 核，24 GB。

## 本次实测

| 项目 | 结果 | 命令 |
| --- | --- | --- |
| Rust 测试 | 36 单元（含索引范围的归一化与成员判断）+ 5 集成（真扫描、真落盘缩略图、契约文件比对、索引范围） | `npm run test:rust` |
| 前端单测 | 70 通过：会话状态机（含 scoping 阶段、过期答复与过期重扫）、墙布局与按键、索引范围树、文件夹树、索引状态 | `npm run test:unit` |
| Playwright e2e | 33 条：30 通过，2 条设计截图默认跳过，`viewer.spec.ts` 的胶片条用例 1 条失败（预览不再显示「1 / 12」计数，待该功能的作者确认）。需 `--workers=1`，因为 `video.spec.ts` 运行时向共享的 `public/vault` 写文件 | `npm run e2e -- --workers=1` |
| 桌面端自检 | 7 步全过，真窗口真 IPC | 见下文 |
| 前端构建 | 通过，dist 749.88 kB JS（gzip 240.89 kB）/ 52.10 kB CSS | `npm run build` |
| 桌面打包 | `Shelf.app` 36.88 MiB | `npx tauri build --debug` |
| 启动冒烟 | 进程存活 9 s 后手动结束 | `open src-tauri/target/debug/bundle/macos/Shelf.app` |
| 三栏截图 | 生成到 `verification/three-columns.jpg`，不入库 | `npx playwright test e2e/screenshot.spec.ts` |

模型侧由 `sidecar/` 独立进程负责，实测来自该子任务的报告：加载 2.9 到 3.1 s，文本约 17 ms 一条，图片约 253 ms 一条，峰值 1.19 GB，空闲 766 MB，空闲后自动退出。

## 桌面端自检（真窗口、真 IPC）

浏览器 e2e 走的是 `fetch("/api/...")` 分支，和 Tauri 的 `invoke` 是两套入口，所以另外加了一条只在桌面端跑的链路：应用在 `SHELF_SELFCHECK=1` 时，从真实的 WebView 里依次调用 IPC，把结论写进文件后退出。

```bash
cp -R public/vault /tmp/shelf-sc/vault
rm -rf /tmp/shelf-sc/vault/.shelf/meta/*
SHELF_SELFCHECK=1 SHELF_SELFCHECK_VAULT=/tmp/shelf-sc/vault \
SHELF_SELFCHECK_OUT=/tmp/selfcheck.json SHELF_DATA_DIR=/tmp/shelf-sc/data \
  src-tauri/target/debug/bundle/macos/Shelf.app/Contents/MacOS/shelf
cat /tmp/selfcheck.json
```

最近一次结果，7 步全过：

| 步骤 | 证据 |
| --- | --- |
| 三栏渲染 | 侧栏、中列、检视面板同时存在，缩略图 12 个 |
| 后台索引 | 12 个文件全部索引 |
| 缩略图走 asset 协议 | `convertFileSrc` 给出的 URL 真的解码出 64px 图 |
| 标签写盘 | `乱码名-A7f3.png` 写入标签「自检」 |
| 重新打开后标签还在 | 重扫文件夹后点同一张，检视面板里能看到「自检」 |
| 语义与关键词搜索 | 关键词返回 2 项 |
| 模型进程与语义排序 | 语义返回 1 项，`semantic: true` |

磁盘上的 `.shelf/meta/乱码名-A7f3.png.md`：

```markdown
---
tags: [自检]
rating: 5
---

自检写入
```

这条自检抓出过一个真 bug：`bridge.ts` 里写成 `invoke("cmd", …)`，而 `generate_handler![command]` 注册的名字是 `command`，桌面端每个命令都会返回 `Command cmd not found`。浏览器 e2e 全绿也发现不了，因为那条路径根本不进 Tauri。

## 每次验证怎么跑

```bash
npm run fixtures      # 生成 public/vault 与 fixtures/expected-vault.json
npm run test:rust     # 41 个 Rust 测试
npm run test:unit     # 70 个前端纯逻辑测试（Node 24 直接剥类型运行）
npm run e2e -- --workers=1   # 编译 e2e server 后跑 Playwright 用例
REVIEW_DIR=<dir> npx playwright test e2e/review.spec.ts   # 深浅两套设计截图
```

`npm run e2e` 会拉起两个进程：`shelf-e2e`（同一个 Rust dispatch，走 HTTP）和 Vite。Playwright 打的是真后端，不是前端假数据。

## e2e 覆盖的交互

1. 打开文件夹后左中右三栏同时出现，缩略图墙渲染 12 项
2. 拖动分隔条改变侧栏宽度
3. 中文搜索命中文件名与标签，排序第一项正确
4. 无空格查询「深色登录」命中，无结果时显示空态
5. 筛选「视频」后显示空态
6. 标签写入 `.shelf/meta` 的 `.md`，刷新页面后仍在
7. 评分与备注写入 YAML frontmatter
8. 以图找图把近似重复排在第一位
9. 切换排序改变顺序
10. Finder 新增文件几秒内出现在素材墙，删除后消失
11. 暂停与继续索引
12. 模型就绪后搜索从关键词排序升级为语义排序
13. 三栏截图留档
14. 首次打开文件夹先选索引范围：去掉「人像」后只索引 9 张，`.shelf/scope.json` 记下 `摄影/人像`；之后从文件夹菜单改回，12 张回到墙上
15. 首次打开时取消，回到未打开状态，不写索引范围

## 组件来源

界面组件是 shadcn/ui 的 Base UI 版（`components.json` 里 `"style": "base-nova"`），生成在 `src/components/ui/`，Retry 的差异直接写在这些文件里，业务组件只负责组合：

- `button` `input` `textarea` `select` `tabs` `tooltip` `separator` `skeleton` `label`
- 图标 `@phosphor-icons/react`，只出现在动作上：搜索框放大镜、暂停/继续、更换文件夹、重试、找相似
- 单位派生 `class-variance-authority`，类合并 `clsx` + `tailwind-merge`（`@/lib/utils` 的 `cn`）
- 路径别名 `@/*` 指向 `src/*`，tsconfig 与 vite 各配一份

改在组件里的 Retry 差异：

| 组件 | 差异 |
| --- | --- |
| Button | `rounded-md`，2px focus ring 加 2px offset，disabled 用 `bg-surface-1 text-subtle-foreground`，primary hover 用 `--primary-hover`，删掉 outline 变体 |
| Input / Textarea / Select | 填充 `bg-muted` 加 `border-input`，focus 走 `ring-2 ring-ring-soft`，`rounded-md` |
| Tabs | 触发态 `bg-surface-2`，去掉下划线伪元素和 emerald |
| Tooltip | `bg-foreground text-background`，`rounded-md` |
| Skeleton | `bg-surface-2` |

主界面里没有 primary 按钮，唯一的 primary 是打开页的「打开文件夹」。

按 sweet-mode 的硬约束改过的组件：

- `transition-all` 换成分属性的 `transition-colors`（Button、Tabs），按压位移单独走 `transition-transform`
- `rounded-[min(var(--radius-md),10px)]`、`rounded-[2px]` 这类任意值换成 `rounded-sm`、`rounded-xs`
- `text-[0.8rem]` 换成 `text-xs`
- 色板与主色点不再用内联 `backgroundColor`，改成 `style={{ "--swatch": hex }}` 加 `bg-(--swatch)`
- `ui-guardrails.js` 扫全项目 16 个文件，零命中

## 文案（ux-writing 对照表）

| 位置 | 原文案 | 新文案 | 消除的摩擦 |
| --- | --- | --- | --- |
| 打开页主标 | 打开一个文件夹 | 选一个文件夹，素材就地可搜 | 说清收益，不只说动作 |
| 打开页说明 | 文件夹就是素材库。不导入、不复制、不改名，图片和视频留在原地。 | 不导入、不复制、不改名。图片和视频留在原处，标签和备注跟着文件夹走。 | 少一句概念定义，补上用户关心的东西去哪 |
| 路径输入 | /Users/you/Pictures/inspiration | 例如 /Users/you/Pictures/inspiration | 占位符给格式范例 |
| 打开按钮进行中 | 打开中… | 正在打开 | 省略号换成完整状态 |
| 打开失败 | path is required / X is not a folder / sidecar 原文 | 先填一个文件夹路径。/ 这个路径不是一个文件夹，换一个再试。/ 模型没启动起来，搜索现在只用关键词。 | 不暴露内部英文与错误码，直接给下一步 |
| 侧栏进度 | 索引 12/12 · 语义 12/12 | 预览 12/12 · 可搜索 12/12 | 机制词换成用户能验的结果 |
| 侧栏状态 | 正在生成缩略图 / 正在生成向量 / 等待模型进程 / 索引完成 / 已暂停索引 | 正在生成预览 / 语义索引中 / 正在启动模型 / 全部就绪 / 已暂停 | 同上，去掉进程与队列细节 |
| 模型提示 | 模型进程未就绪，搜索暂用关键词排序。 | 语义搜索还在启动，先用关键词。 | 去掉实现层名词 |
| 结果计数 | 9 项 · 语义排序 · 1996ms | 9 项 · 按语义 · 2.0s | 说排序依据；超过一秒换秒 |
| 重试按钮 | 重试语义 | 重试 | 上文已说明重试什么 |
| 相似视图 | 相似素材 / 按构图哈希、主色和图像向量排序 | 相似的素材 / 构图、主色和画面都接近的排在前面 | 去掉哈希与向量 |
| 空文件夹 | 这个文件夹里没有素材 / 放一些图片或视频进来，Shelf 会在后台生成缩略图和向量。 | 这个文件夹还没有素材 / 把图片或视频放进来，Shelf 会生成预览，并让它们能按意思搜到。 | 空态给期待与下一步 |
| 无结果 | 没有匹配的素材 / 换个说法，或者放宽筛选条件。 | 没有匹配的素材 / 换个说法试试，或者清掉筛选条件。 | 配一个「清空筛选」按钮，空态有出路 |
| 标签输入 | 加标签后回车 | 加标签，回车 | 统一成动作加确认方式 |
| 备注输入 | 写点什么，随文件夹一起同步 | 记一句，会跟着文件夹一起同步 | 平视的说法 |
| 检视面板空态 | 选一张素材，这里显示尺寸、主色、标签和备注。 | 选一张素材，就能看到它的尺寸、主色、标签和备注。 | 少一层从句 |

按 sweet-mode 第 3 节补的状态：

- 索引未完成的缩略图位用 `Skeleton` 占位，检视面板的尺寸与主色同
- 搜索进行中主列降到 60% 不透明度，旧结果不闪走
- 搜索成功后清掉错误条，报错不会常驻
- 网格列宽扣掉 48px 内边距再算，末列不再顶到边
- 网格首帧改用 `useLayoutEffect` 测量，避免一帧单列重排
- 空态带出路按钮，键盘焦点在缩略图上有可见环

## 设计规范逐条核对

对着 `design/DESIGN.md` 和截图看，逐项确认：

- 阴影全部为空，`globals.css` 里已置空，界面里没有一处阴影
- 没有渐变、玻璃、网格背景，深度靠 `bg-background` 到 `bg-surface-3` 的明度差
- 卡片无边框，缩略图是 `rounded-md bg-surface-1`
- 一屏只有一个 primary 按钮，主界面没有 primary，打开页的「打开文件夹」是唯一一个
- 分栏宽度：侧栏 216（w-54），检视面板 320（w-80），控件 h-8 / h-9 / h-10
- 数字一律 `tabular-nums`，界面字 `text-sm`，元信息 `text-xs`
- 选中与焦点用 2px `ring`，主色只在焦点、选中和 primary 上出现
- 状态点加文字，不用 badge 装元信息

截图里能直接看到的一条：搜索框是绿色焦点环，选中项是绿色描边，其余全是灰阶。

## 与 PRD MVP 的对照

做到了的：

| MVP 项 | 实现 |
| --- | --- |
| 文件夹即 vault | 路径输入加最近打开列表，不导入不复制 |
| 文件夹树与图片墙 | 左侧树带计数，右侧虚拟化滚动，缩略图可调 96 到 240 |
| 查看器 | 大图、视频、GIF，显示尺寸、格式、大小、修改时间、主色、路径 |
| 文件监听 | `notify` FSEvents 置脏标记，前端 2 s 轮询后重扫 |
| 后台索引 | 每 500 ms 一片，缩略图先行，向量随后，可暂停继续，显示进度 |
| 自然语言搜索 | EmbeddingGemma 2 语义向量加中文 bigram 关键词，RRF 融合，2 项实测 27 到 37 ms |
| 以图找图 | dHash、主色距离、图片向量三项加权 |
| 筛选 | 类型、方向、最小宽度、最低评分、主色，可与搜索叠加 |

没做到的，和原因：

- 原生文件夹选择框。用路径输入加最近列表代替，省掉 `rfd` 依赖。
- 视频镜头切段与片段跳转。视频能播放，但没有做按镜头切段索引。
- 向量检索用的是暴力余弦，没有用 sqlite-vec。12 个素材够用，10 万张需要换。

## 踩过并修掉的问题

- 侧栏数据目录传相对路径时，缩略图落到模型进程解不开的相对路径，`/embed` 一律 400。改成 `data_dir()` 永远返回绝对路径。
- 索引循环闭包捕获旧的 query，把筛选结果冲回全量。改成 ref 取最新值。
- StrictMode 重挂载后自驱循环停摆，向量永远不补。改成幂等的 500 ms tick。
- 并发 `warm_model` 拉起三个模型进程，端口抢占加 3.6 GB 内存。加单飞锁。
- 搜索里同步等模型启动，一次查询阻塞 90 s。改成模型没好就返回关键词结果，模型热了再自动重排。

## 已知局限

- `public/vault` 里是脚本生成的渐变图，语义质量没法从它们身上读出来。模型本身的语义能力由 `sidecar/smoke.py` 的文本相似度断言证明，图片路径只证明视觉塔能跑通。
- 三栏宽度是像素级的，不是 w-54 这种类名，因为要支持拖拽。


## 状态机

浏览器端只有一个状态机，`src/lib/vault-machine.ts`，13 个单测覆盖相位迁移。之前踩的坑是同一个形状：异步结果落回了一个已经不存在或已经变化的状态。现在每个事件都声明自己在哪些相位合法，不合法的直接丢弃。

- 相位：`idle → opening → deriving → embedding → ready`，另有 `paused` 与 `failed`
- `OPENED` 只在 `opening` 接受，晚到的扫描结果不会覆盖已关闭的文件夹
- `SLICE` 只在 `deriving`/`embedding` 接受，暂停、完成、失败时一律忽略
- `PAUSE` 可以从 `ready` 触发，用来拦住「新文件一落地就开始索引」，`pausedFrom` 记住回来的相位
- `RESCAN` 只更新计数，相位在 `paused` 时不动
- `MODEL_READY` 在任何相位都让 epoch 加一，触发的是一次重排，不会把暂停的索引起

`useVault` 只剩事件派发与副作用，不再自己拼相位。

## 向量检索

`src-tauri/src/vectors.rs`，sqlite-vec 0.1.9 加 rusqlite 0.40（自带 SQLite）：

- `text_vectors` 与 `image_vectors` 两张 `vec0` 虚表，`distance_metric=cosine`，256 维 float
- 写入走 `INSERT OR REPLACE`，按 256 维截断后的向量
- 查询是 `WHERE embedding MATCH ? AND k = ? ORDER BY distance`，不再在 Rust 里遍历所有向量
- 离开文件夹的文件由 `retain` 清掉三个表里的对应行
- 缓存目录里因此多一个 `vectors.db`，`index.json` 只剩缩略图路径、尺寸、主色、dHash

## 其它

- 原生文件夹选择框：`tauri-plugin-dialog`，`capabilities/default.json` 只开 `dialog:allow-open`。浏览器构建里不显示这个按钮，因为没有选择框可调。
- 侧栏用 shadcn 的 `sidebar` 原语（`SidebarProvider`、`SidebarContent`、`SidebarMenu`、`SidebarFooter`、`SidebarInset`、`SidebarTrigger`），收起展开走库里的行为，自定义分隔条删掉了。
- 依赖都是当前最新：vite 8、@vitejs/plugin-react 6、TypeScript 7、motion 14、tauri 2.12、rusqlite 0.40、sqlite-vec 0.1.9、@phosphor-icons/react、@playwright/test、@tauri-apps/{api,cli,plugin-dialog} 2.x。TS 7 删掉了 `baseUrl`，tsconfig 已改成纯 `paths`。
- 测试素材换成真实照片：`/Users/zhangzimin/Documents/aquavo/olio/assets/pinterest-home-50`，12 张，1.9 MB。`scripts/make-fixtures.mjs` 只做拷贝、读尺寸、写契约，不再画渐变。黄昏逆光-01 与 -02 是同一张照片，所以「找相似」有一个真的近似重复可排。
