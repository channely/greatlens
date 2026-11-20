# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### idea-first：AI 专业分析自动填充 brief + 修复阶段切换 404（2026-11-20）

- 首页 seed 进入「从创意开始」后，brief 六字段（主角/欲望/反对力量/片长形式/调性/主题约束）由 AI（qwen4-max）专业分析自动填充，用户可直接修改；提供「重新分析填充」按钮。模型未配置/失败/测试环境自动回退本地确定性抽取，流程不中断
- 分析字段有长度上限（主角≤24、欲望≤30 等），避免冗长输出污染后续标题与项目名；用户已填字段不被覆盖
- 修复用户在标题阶段看到「请求失败 404」：根因是运行中的 8787 进程为旧代码（源码路由 `/api/ai/idea` 一直存在），重启服务加载新代码后消失；新增 `/api/ai/idea/brief` 路由与 `api.ai.analyzeBrief`
- 验证：`npm test` 34/34；完整 8 阶段 + 建项 HTTP 端到端跑通（brief=ai，建项 201，节点 3）

### 对齐 laper 的深度迭代（P0→P3，2026-11-20）

依照 laper 官方文档（34 docs + 12 features 页）逐项对齐，排除团队协作/角色管理，保留强于 laper 的能力（单条 30 秒视频）。全程不改历史兼容层，旧特性不适合即改造/抛弃。

**P0 消除虚假/误导入口**
- 移除侧栏纯装饰的「灵感片段 00:15」播放条、「Login」假按钮、标题与路由不符的 4 个底部图标；GitHub 链接改真实仓库
- 收敛 Fountain 导入：导入 UI 曾接受 `.fountain/.txt` 却一律送进 FDX 的 XML 解析器（必然失败）；对齐 laper「仅 FDX 导入」，accept 与文案统一
- 新增 `tests/noFakeUI.test.mjs`：静态扫描已识别的假入口模式（假播放条 / 空 onClick / 假 href / 通用 GitHub / Fountain 导入 / 误导 title）并校验前端 api 调用都有后端路由

**P1 核心能力补齐**
- 分镜连续性硬约束：`shot.continuity` 开启后，生成分镜图前若前一镜没有分镜图，服务端在派发任务前 428 阻断（不建任务、不扣费），并把前帧作为视觉参考注入 prompt；对齐 laper「缺前帧则阻断」
- Script→Cinema 显式转换：`POST /api/projects/:id/to-cinema`，一次性把场景→Reel、正文→表演、角色/道具/世界观/资料复制到独立 Cinema 项目；源项目保持不变，不做往返合并（对齐 laper peer 文档模型）
- 字级选区闭环复核后确认已实现；补全 `cursor` scope（以光标节点为中心取前后各两节点）
- idea-first 附件开放 DOCX/PDF/MD/TXT/图片，明确「仅作上下文证据，不逐字复制进剧本」
- 项目设置「默认顾问」从禁用假控件改为可编辑并持久化（后端 `saveSettings` 校验顾问合法性）
- Cinema 分镜图入口改标题为「分镜图 URL（外部生成）」，去掉误导的「生成任务接入点」

**P2 实体与生产管理层**
- Reels 三视图：Cinema 新增 Board / Timeline / List 切换（对齐 laper Reels 的 board/timeline/list）；List 显示场景/镜头/时长/连续/成片并可删除，Timeline 按段时长横向排列
- 知识库可被 AI 实际引用：编辑器「落点/权限」面板可点名本次引用的资料并写明用途，有界正文（每份 ≤4000 字）注入 prompt；世界观规则值改为可就地编辑
- Cinema 成片任务后端带 `reelId`/`binding`，数据层即可区分「reel 绑定任务」与「自由生成任务」（对齐 laper 任务分流）
- 选角表补「人物弧光」列；地点新增「勘景表」视图（canvas/group/table 之外）
- 复核后确认已实现、未重复建设：Timeline 多轨、Beats 画布+Save the Cat、导出 PDF/DOCX/TXT/FDX、casting/关系图与 analyzeRelationships 全链路

**P3 工程收尾**
- 用量页接入冲正记录（失败任务/作废资产的幂等退款，净额抵扣不计调用次数）
- 有意差异固定：单条 30 秒超集 / Script-Cinema peer 分离 / idea-first 不套模板 / 不做 Fountain 导入 / 排除协作与社区
- 验证：`npm test` 31/31 通过；`npm run build` 通过；`git diff --check` 干净

历史迭代（P0 全部 + P2 全部；P1 多模态输入暂列长期考虑，未实现）：

### Added — 批次 1：项目版本历史与安全恢复

- 项目新增 `schemaVersion/revision/versionHash`：每次保存带 `If-Match`，旧标签页或过期草稿被拒绝（409），不再静默覆盖新状态
- 版本快照独立于 `db.json` 写入 `data/versions/<projectId>/`：自动版本记录编辑前状态，60 秒编辑窗口内合并为一个版本；命名版本不自动清理；恢复前自动备份
- Script 与 Cinema 工作台新增「版本」入口：可命名、重命名、删除、恢复到指定版本；恢复后清空撤销/重做与选区，Cinema 的 Reel 成片版本随项目快照一起保留
- 旧库幂等迁移：字符串角色/地点/道具转对象，语义节点、大纲、节拍、场景、镜头、Reel 补稳定 ID，为后续结构化 AI 定点写入打底；`GL_DATA_DIR` 支持测试隔离，Git 同步同时携带版本快照
- 验证：`npm test` 3/3 通过（迁移幂等、revision 冲突、60 秒窗口、恢复前备份、Reel 版本快照）；`npm run build` 通过；真实数据副本迁移为 7 个项目、schemaVersion=1

### Added — 批次 2：上传与实体资产回填

- 素材支持本地上传（图片 / 视频 / 音频，≤10MB），与生成资产共用素材库；上传可直接带项目或实体绑定
- 新增真实绑定 API：`PUT/DELETE /api/media/assets/:assetId/binding` 与 `GET /api/projects/:id/assets`。一次写入同时维护资产反向索引与实体槽，重复绑定幂等，解绑后实体显示未绑定
- 角色、地点、道具、镜头增加素材槽入口；素材卡「保存到项目」改为真实关联，不再只改前端状态。实体视觉字段使用独立 `lookImage/posterImage/refImage`，不覆盖文本描述
- 验证：`npm test` 5/5 通过（上传、双向索引、项目资产查询、非法槽位 422、版本回归）；`npm run build` 通过

### Added — 批次 3：项目设置与 idea-first 开局

- Script / Cinema 工作台新增项目设置：Project / Format / AI 三 tab。封面与 logline 写入 `project.cover`，格式与导出约定读写同一 `project.settings`，导出弹窗的「剧本惯例」直接保存回项目设置
- 项目页新增「从创意开始」向导：brief 四要素 → 标题 → 大纲 → 节拍 → 核心角色 → 地点 → 开场场景 → 最终复核；提案阶段不写项目，最终用 `clientDraftId` 幂等建项并保存「AI 创意初始版本」
- 支持 TXT / Markdown / 图片参考附件；创建后给出逐视图复核清单，可直接跳转大纲、节拍、剧本、角色、地点
- 验证：`npm test` 6/6 通过（阶段提案、零提前建项、幂等创建、设置同源与 409）；`npm run build` 通过

### Added — 批次 4：写作与 AI 协作对齐

- 写组新增「封面」视图：标题 / 副标题 / 作者 / logline / 版权 / 简介独立写 `project.cover`，不污染剧本节点
- 新增 `POST /api/ai/act`：诊断、处方、结构化动作分离；动作使用稳定 `targetNodeId` 与 `expectedText` 在当前项目重定位，节点消失或上下文变化即 409/422 fail closed，采纳前不写项目
- Script Doctor 固定「诊断 → 处方 → 选择 → 采纳」：没有 diagnosisToken 不能跳阶段；每条处方显示优先级、目标节点与保护作者意图说明
- 保留自由文本 AI 兜底、可编辑时间轴、交付前检查和现场连续性提示
- 验证：`npm test` 7/7 通过（阶段门禁、稳定 ID 写入、目标缺失拒绝、旧 revision 拒绝）；`npm run build` 通过

### Added — 批次 5：场景 / 分镜多视图与 Space

- 场景从剧本 scene heading 的 `nodeId` 派生，提供 table / canvas；场景背景与备注写入制作元数据，不复制第二份场景文档
- 分镜提供 panel / table / canvas 三视图，三视图共享 `ep.shots`；拖动画布只写 `viewLayouts.storyboard[episodeId]`，不改变镜头顺序
- 新增通用 CanvasBoard：拖动中只更新本地坐标，松手才提交一次；Space 只展示当前项目的资产画布与任务列表，不做通用实体关系图
- 验证：`npm test` 8/8 通过（scene nodeId、布局持久化与既有回归）；`npm run build` 通过

### Added — 批次 6：海报 / 选角 / 场景 / 分镜生成收口

- 角色、地点、道具、场景、镜头增加「上下文生成」入口：prompt 由项目、cover、世界观与对象档案组装，用户输入只作追加；成功首图自动回填当前槽位，其余进入素材库
- 新增异步任务元数据 `purpose/binding/request/bindingStatus`；慢任务发现槽位已变时标 `needs-review`，不抢占现有选择
- 媒体 finalize 加入 per-task Promise 锁与 `usageRecordedAt` 幂等标记，并发轮询不会重复生成资产或重复计费；Cinema 成片版本按 `taskId + url` 去重
- 模型下拉统一消费 `/api/models`；素材 / Cinema / Space 共用 `useMediaTasks` 刷新任务。验证：`npm test` 9/9 通过，`GL_STUB_MODELS=1` 下真实 DashScope 调用为 0

### Added — 批次 7：导演圆桌与剧本围读

- 新增「声音」视图：导演圆桌先出对谈稿并需确认；剧本围读从现有 `ep.nodes` 派生，不复制第二份剧本
- 接入 `qwen-audio-3.1-tts-next` 同步非流式接口（WorkspaceId 北京域名）；圆桌最长 240 秒，其他场景 120 秒；prompt ≤3000 字符，参考音频 ≤3 条 / 每条 ≤30 秒 / ≤10MB。超长要求缩小范围，不静默截断
- 24h URL 立即本地化，audio asset 可直接 `<audio controls>`；成功即 succeeded，不走远端轮询；网络中断标「结果未知」，禁止自动重派
- 单价输入 ¥6 / 输出 ¥12 每百万 Token；只有接口返回可计费 Token 才记精确成本，否则标「未知」，不拿时长冒充 Token。设置页补 WorkspaceId、音频模型与价格；素材库显示音频资产
- 验证：`npm test` 10/10 通过（stub 同步合成、token 记账、超时与超长拒绝、零真实调用）；`npm run build` 通过

### Added — REA 复审后的五项非协作能力补齐（同日）

- **① AI 任务失败冲正与后端重试**：`usage` 新增按 `refundKey` 幂等的负成本冲正记录，`report` 净额抵扣且不虚增调用次数；查询与提交对瞬时错误（0/408/429/5xx）指数退避重试；远端任务失败时后端按保存的 submit 规格自动重提一次（provider id 更换、前端 taskId 保持稳定），重提耗尽才判失败并冲销已记费用；新增 `GET /api/usage/refunds` 与 `POST /api/media/task/:id/refund`，素材卡可手动「冲销计费」
- **② 作者口味记忆**：新增 `server/taste.js`，把采纳/弃用的 AI 输出与显式规则沉淀为按项目隔离的长期偏好（有界 events/accepted/rejected/rules + 开关），确定性注入后续 AI 的 system 提示，优先级低于本次 constraints/authority；助手回复新增「👍 喜欢 / 👎 弃用」，创作助手面板新增「口味」管理入口
- **③ 草稿级修订说明与 Option 备选**：新增 `server/revisions.js`，对节拍/语义节点生成 Option 1/2/3 确定性备选；提案不写项目，采纳时按稳定 ID + expectedText + token + revision 四道校验 fail closed，并自动存版本快照；修订说明只做批注不改原文；创作助手面板新增「修订」入口
- **④ 新建项目起始模板**：新增 `server/templates.js` 与 `GET /api/project-templates`，Script 项目可选空白剧本 / 三幕结构 / 角色优先三种起始模板（预置大纲、节拍或角色骨架，均带稳定 ID）；保留 idea-first 向导与 15 节拍模板
- **⑤ 电影海报独立生成目的**：`generation.js` 新增 `purpose=poster` 分支，用片名/副标题/Logline/世界观/主要人物与场景组装专用海报 Prompt（明确留出版面、不生成伪文字），回填 `project.posterImage`；封面视图新增海报道具与「生成电影海报」入口
- 验证：`npm test` 22/22 通过（新增 reliability / taste / revisions / templates / poster 五组测试，全部 stub、零真实调用）；`npm run build` 通过；`git diff --check` 通过；stub 服务实际请求三个新端点均正常


### Added — Cinema 成片内建生成（对齐 laper 的 task + 版本回填）

- 「成片」阶段从手填 URL 升级为完整生成流程：按 laper.ai 官方 `cinema-pipeline` / `ai-assets` 的口径——显式生成任务（成本可见、状态/重试）、多版本选择、结果回填 Reel
- **派发前可见**：自动从本 Reel 的场景 + 表演 + 全部镜头（景别/机位/运动/画面/声音）+ 世界观风格与负面提示组装 prompt，可展开预览；分辨率选 480P/720P/1080P，按秒估算费用实时显示
- **一键生成**：调用 `wan3.0-video` 生成整条 Reel 视频（时长取 `reel.duration`，最长 30 秒），后台任务轮询带网络抖动退避重试（与素材页一致），失败可「重新查询」
- **版本管理**：每次成功生成创建一个版本并自动设为当前成片；版本列表可预览、对比、「设为成片」、复制 URL、删除；手填外部 URL 作为兜底保留在折叠区
- 前端计费口径抽到 `src/pricing.js`，素材页与 Cinema 共用，避免两份漂移
- CDP 验证（stub 百炼响应，无真实扣费）：payload 含完整 prompt + `duration:30` + `resolution:480P` + `model:wan3.0-video` + `projectId`；估算 ¥6.300；成功后版本面板出现 V1 与「当前成片」；零 console 错误、零溢出

### Changed — Cinema 单条时长 15 秒 → 30 秒

- Cinema 工作台不再写死 15 秒：`reel.duration` 参与显示（顶栏 / 表演 / 成片阶段），场景阶段新增可编辑的「单条时长（秒，最长 30）」输入，钳制 1–30；新建 Reel 默认 30 秒、`continuity` 默认 `natural`
- 内置《海风与橘子 Cinema》由 2 个 15 秒 Reel 合并为 **1 个 30 秒 Reel**（7 镜头 0–30s），道具连续性说明按新镜头编号改写；不再需要末帧接续。示例 JSON、录入说明与 `data/db.json` 已同步
- 项目页 Cinema 入口文案改为「最长 30 秒成片」；平台侧 `wan3.0-video` 单条 30 秒上限由 `server/models.js` 统一约束（与素材页一致）
- CDP 验证：示例项目单 Reel、duration=30、7 镜头渲染正确

### Fixed — 生成任务轮询健壮性

- 修复视频生成时任务卡显示 `Failed to fetch` 却被判为失败的问题：根因是轮询期间一次网络层断连（如后端重启）就把任务标死，而后端与百炼任务其实仍在跑（实测该任务已在后端 `succeeded` 并落地 mp4）
- 网络错误改为**可重试**：`Failed to fetch` / `NetworkError` 不再判失败，任务保持「生成中」并显示「连接中断，正在重试（n/20）…」，退避重试（最高 10s 间隔）
- **刷新恢复**：新增 `GET /api/media/tasks` 列出近期任务，素材页加载时自动把后端仍 `pending` 的任务重新挂上轮询，避免刷新后任务失联
- 失败 / 生成中任务卡新增「重新查询」按钮，可手动续查
- CDP 验证：注入一次 `Failed to fetch` 后任务仍为「生成中」并显示重试提示（未判失败）；注入 pending 任务刷新后自动恢复并轮询；零 console 错误

### Fixed — 图像生成尺寸格式

- 修复素材工作台「图像生成」报 `InvalidParameter: Expected format: '<width>*<height>'`：前端尺寸值原为 `1024x1024`（字母 x），百炼要求星号 `1024*1024`。前端三档尺寸改为 `*` 格式；后端新增 `normalizeImageSize()` 兜底，把 `x` / `X` / `×` 统一转成 `*`，非法或越界值回退 `1024*1024`，兼容历史值与手输
- CDP 核查：尺寸下拉仅含 `*` 格式、默认 `1024*1024`，实际请求 payload 为 `size: "1024*1024"`，零 console 错误

### Changed — 模型与计费重构

- **默认模型升级**：图像默认 `qwen-image-3.0`、视频默认 `wan3.0-video`；设置页下拉与素材工作台统一，旧项目历史模型仍可选
- **视频改为按秒计费**：单价随输出分辨率分档（480P ¥0.3/s、720P ¥0.6/s、1080P ¥1.2/s，控制台标价），默认生成 **480P**；输入视频与输出视频时长均计入，单价取输出分辨率档；单条时长钳制为 **1–30 秒**（后端与前端双重校验）
- **限时 7 折可配置**：新增 `videoDiscount`（默认 0.7），折后单价在设置页实时展示；改 1 即按标价估算
- **图像改为按张拆分计费**：生成 ¥0.18/张 + 输入图 ¥0.02/张（1K/2K 同价），图生图支持多张参考图 URL，按张计入
- **计费口径单一来源**：新增 `server/models.js` 统一模型目录、默认项、分辨率上限与估算函数；`GET /api/models` 供前端使用；`data/settings.json` 旧的 `imageUnitPrice` / `videoUnitPrice` 在启动时自动迁移移除
- 设置项白名单与校验：`/api/settings` 接受新价格键，分辨率归一化、折扣钳制 0.01–1，注入旧键被拒绝

### Added

- **交付前一致性检查**：导出弹窗内置就绪度面板，聚合三类信号——实体一致性（道具字段/地点登记/角色档案，复用连续性审计）、时间线（镜头累计时长 vs 目标）、镜头完整性（画面描述/参考图/节拍内容）；分「需核对 / 可优化」两级呈现，检查只提示不改动项目
- **写作现场连续性提示**：剧本编辑时若引入未登记的角色或地点，工具栏下方即时提示并一键跳转到生产视图登记；与服务端口径一致，避免两套判定标准
- **项目级撤销 / 重做**：`⌘/Ctrl+Z` 与 `⇧⌘Z`（或 `Ctrl+Y`），保留最多 60 步；工具栏有按钮与可用态。焦点在输入框时交还浏览器原生文本撤销，避免"改一个字撤销整个项目"
- **命令面板**：`⌘/Ctrl+K` 唤出，输入过滤、`↑↓` 选择、`Enter` 执行、`Esc` 关闭；覆盖 tab 导航、加节点、撤销重做、AI 面板开关、主题切换与导出
- **时间轴播放头预览**：点击镜头或标尺移动播放头，预览区显示当前镜头的参考图（或文字占位）与视觉约束备注；移动端自适应竖排

### API

- 新增 `GET /api/projects/:id/readiness`：返回 `{ items, summary, continuity }`，供交付前检查使用
- 新增 `GET /api/models`：模型目录、默认值、分辨率列表与计费口径（单一事实来源）

### Verification

- CDP 渲染核查：`/settings` 三组计费单价、三档分辨率价格、两个模型下拉默认值（qwen-image-3.0 / wan3.0-video / 480P）、文档链接正确；`/assets` 视频 tab 实时估算显示 `¥1.050（480P · ¥0.210/秒）`，时长上限 30；两页零 console 错误、零横向溢出

---

此前六项能力：

补齐与参考产品逐一对齐后仍存在的六项能力：

### Added

- **多轨时间轴**：剧集级 4 轨时间轴（画面 / 声音 / 字幕 / 节拍），秒刻度尺与可移动播放头、镜头时长拖动调整、目标时长与超时提示、镜头详情编辑与排序
- **字级选区改写**：可拖动选中节点内任意文字作为 AI 上下文，仅替换所选片段（原位、不破坏节点语义），工具栏一键「用这段提问」
- **Beats 节拍板**：Save the Cat 15 节拍模板、自定义节拍增删改排序、SVG 强度曲线、AI 生成/细化节拍、大纲对照
- **创意资料导入**：DOCX / PDF / Markdown / TXT 零依赖解析为文本，可加入项目知识库或据此新建项目；扫描件给出人工核对提示
- **分镜参考图槽位**：每个镜头可挂本地素材库图片并写视觉约束备注，AI 分镜时作为视觉一致性参考
- **地点画布 / 分组 / 关系视图**：地点卡片画布拖动定位、按分组着色、按同场次共现连线的关系图，与剧本派生地点一键登记对照

### Changed

- **UI 去「AI 味」P0**：圆角统一收敛为四档令牌（`--r-xs/sm/md/lg`），清除全部散落像素值与多值圆角里的硬编码；配色收敛为三色体系（森林绿主色 / 亮绿强调 / 琥珀警示），告警、危险、失败态统一走 `--warn*` 令牌，移除第四种红色
- **UI 去「AI 味」P1**：编辑器 9 个 tab 按工作动线分为「写 / 看 / 管」三组（单字组标 + 细分隔，窄屏自动隐藏组标、tab 行可横向滚动）；侧栏导航按「工作台 / 运营 / 系统」分组，底部装饰区拆为状态 / 入口两组，首页与全部装饰元素原样保留
- **UI 去「AI 味」P2**：解释性文案改为操作后果式短句；时间轴 / 节拍板 / 地点画布三处组件内联样式合并进 `features.css`，圆角与告警色同步令牌化
- **去装饰性状态反馈**：侧栏与剧本节点选区的 `inset` 左侧彩条移除，改用中性表面色差 + 字重 + 图标着色表达选中；去按钮/卡片的 `translateY` hover 上浮、时间轴块 `brightness` 提亮、状态点与节拍行的光环 `box-shadow`；浅绿底选中态收敛到 `--surface-2/3` 令牌。提示条语义边线、tab 经典下划线、焦点环等功能性设计保留
- 修复窄屏编辑器标题栏把「编辑中…」挤成竖排的问题（保存状态不换行、操作区独占一行）

### Fixed

- AI 面板加入「顾问视角」后，单行 flex 把三个下拉挤成 14px 竖排文字；改为换行布局，标签恢复可读宽度

## [0.2.0] - 2026-11-18

按对创作的实际影响，补齐与参考产品对齐的三层能力（侦察依据为官方公开文档 `llms-full.txt`）。

### Added

- **AI 定点改写**：读取范围新增「节点 / 选中区间」；Shift 点选节点区间、右键菜单（插入 / 设为定点目标 / 移动 / 删除）、拖拽排序；改写模式下可把结果**原位替换**选中节点，而非只能追加末尾
- **落点四要素**：AI 请求携带 target / intention / constraints / authority，并附带项目级上下文（剧集清单、世界观规则、知识库**仅索引**、实体清单）；服务端据此注入 system prompt，超 800 节点全稿标注读取边界
- **Advisor 顾问视角**：6 种官方方法论 lens（剧本医生 / 结构 / 对白 / 制片可行性 / 短剧节奏 / 视听语言），单顾问工作流，切换 AI 诊断的方法视角
- **交付导出引擎**（零依赖纯 JS）：FDX / PDF / DOCX / TXT，Hollywood / Asian 两种剧本惯例、多集合并、批注不进导出；PDF 支持中文（STSong-Light）
- **实体与生产管理层**：选角表、SVG 关系图谱（自动标出"声明但从未同场"的关系与零连接角色）、地点 / 道具视图 + 连续性审计、知识库 index→search→read（AI 只拿索引）、worldview 显式授权写入、跨集清单
- **深 / 浅主题**：`useSyncExternalStore` 单例状态、localStorage 持久化、多标签同步、防闪烁；侧栏切换按钮

### Changed

- 知识库改为「先索引后按需读取」，避免整库注入每次对话（对齐 index → search → inspect → read 模式）
- AI usage 记录补充 advisor / authority 元数据
- 新增 `data-theme` 属性驱动的设计令牌层，暗色态覆盖硬编码白底

## [0.1.0] - 2026-11-17

首个可用版本。自研 AI 原生剧本 / 短片创作工作台，功能与交互逻辑参考公开可观察的产品形态，代码全部重写。

### Added

- **Script 剧本工作台**：语义节点编辑器（场景 / 动作 / 角色 / 对白 / 括号 / 转场 / 字幕 / 批注）、自动派生场景与角色、大纲、世界观、角色档案、分镜表、Fountain / Markdown / JSON 导出
- **Cinema 短片工作台**：场景 → 表演 → 文字分镜 → 分镜图 → 成片五阶段流水线
- **AI 助手**：显式读取范围 + 五种模式，SSE 流式输出与可折叠思考过程，一键采纳为语义节点
- **模型接入**：阿里百炼 qwen4-max（OpenAI 兼容，含 thinking）、qwen-image 系列图像生成、wan 系列视频生成；生成结果自动下载本地持久化
- **用量与计费**：真实 token 统计（输入 / 输出 / 思考链分列）、按模型与按天明细、单价可配置
- **FDX / Fountain 导入**：解析为语义节点，支持新建或合并项目
- **异地协作**：共享后端（远程 API 根地址）与 Git 快照同步两种模式，密钥不进入远端
- **响应式 UI**：桌面侧栏 / 平板与手机顶部导航，多尺寸无横向溢出
- **安全**：本机来源校验（`GL_ALLOW_ORIGINS` 可放行远程）、密钥仅存本地并掩码显示、`.gitignore` 排除数据目录

### Changed

- 后端改为内存镜像 + 原子写入，读操作零磁盘 IO
- SSE 支持 AbortSignal，组件卸载 / 重新生成时取消在途请求
- 编辑器自动保存改为防抖 + 引用同步，消除竞态与 StrictMode 重复保存

### Notes

- 本版本为个人自用定位，未提供用户系统、社区、计费系统
- 品牌标识、Logo、专有文案与源码未复制；后台为公开信息推断重写，非逐行还原
