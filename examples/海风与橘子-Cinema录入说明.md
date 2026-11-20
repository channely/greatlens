# 《海风与橘子》Cinema 录入说明

项目已创建在本地（项目名 `海风与橘子 Cinema`），打开 http://127.0.0.1:8787 → 「项目」→ 该项目 → 进入 Cinema 工作台即可看到。

## 一、关键设计决策：单条 30 秒 Reel

Cinema 工作台与素材页现在都支持**单条最长 30 秒**视频生成。本片正好 30 秒，因此装入 **1 个 Reel**（7 个镜头，0–30s），不再拆分成两个 15 秒 Reel。

| Reel | 时间 | 镜头 | 连续性 |
|---|---|---|---|
| Reel 1 · 海风与橘子 | 0–30s | 镜头1 大全景建立(4s) + 镜头2 摘帽(4s) + 镜头3 抛橘(4s) + 镜头4 接橘特写(3s) + 镜头5 挥手告别(5s) + 镜头6 驶离(7s) + 镜头7 淡出(3s) | `natural`（单条独立生成，无需末帧接续） |

> 镜头4（弟弟接住橘子、指尖收紧的 3 秒特写）是原剧本外的画面锚点：既承接抛橘又给挥手告别留了情绪停顿。若不需要，删掉该镜头并把镜头5的 `time` 改为 `12-17s` 即可。

> 单条时长在 Cinema「场景设计」阶段的「单条时长（秒，最长 30）」处可改，改动会写回 `reel.duration`，顶栏与成片阶段都据此显示。若将来要做超过 30 秒的片子，再拆多个 Reel，用 `continuity: 'last-frame'` 末帧接续串联。

## 二、字段映射

### 项目级 `film`（Cinema 专属）
| 字段 | 填入内容 | UI 可见性 |
|---|---|---|
| `orientation` | `landscape`（16:9 横屏） | 顶栏显示"横屏 · 30 秒/Reel（≤30）" |
| `productionType` | `animation`（动画短片） | 无 UI，仅数据 |
| `cameraStyle` | 七个镜头的运动方式串接 | 无 UI，但会进 AI 上下文 |
| `artStyle` | 日系动画电影质感、黄昏暖橙、金色反光、16:9 | 无 UI，但会进 AI 上下文 |

### 项目级 `worldview`（8 条）
画幅、片长、风格、情绪基调、主场景、核心意象、**全局负面提示**都放这里。Cinema 项目默认 `worldview: {}`，但 AI 助手发问时会把整个项目（含 worldview）作为上下文带给模型，所以负面提示不会丢。

### 角色 / 地点 / 道具
与 Script 版相同：沈岚、沈屿写入 `characters`，近海码头写入 `locations`，白帽与橘子写入 `props` 且带 `continuity` 字段（已按 0–30s 的新镜头编号改写）——Cinema 助手的"检查连续性风险"提问会用到。

### Reel 内字段
| 阶段 | 字段 | 填入内容 |
|---|---|---|
| 场景 | `title` | Reel 1 · 海风与橘子（0–30s） |
| 场景 | `duration` | `30`（秒，1–30 可编辑，顶栏/成片据此显示） |
| 场景 | `scene` | 环境 + 时间/光线/声音 + 本 Reel 叙事说明 |
| 场景 | `refs` | 参考图 URL（暂空，生成图后填） |
| 表演 | `performance` | 用 `@角色` `#道具` 标记的可拍摄动作描述 |
| 文字分镜 | `shots[]` | 每镜：`time`(秒段) / `size`(景别) / `camera`(机位) / `motion`(运动) / `visual`(画面Prompt) / `audio`(音效) |
| 分镜图 | `storyboardImage` | 图片 URL（暂空） |
| 成片 | `clip` | 视频 URL（暂空） |
| 成片 | `continuity` | `last-frame` / `natural` |

**画面 Prompt 的落点**：原剧本每镜的"画面Prompt"写进了 `shot.visual`——这是可直接复制到「素材」页生成图片的字段。全局负面提示在 `worldview`，生成图片时手动填到素材页的 negativePrompt 输入框。

## 三、与 Script 版的区别

| 维度 | Script 版 | Cinema 版 |
|---|---|---|
| 时间单位 | `shots` 带独立 duration，时间轴自适应 | 单 Reel 最长 30s，`reel.duration` 可编辑，镜头用 `time` 字符串描述秒段 |
| 事实来源 | `episodes[0].nodes`（语义节点） | `reels[].performance`（表演描述） |
| 阶段 | 9 个平铺 tab | 5 阶段流水线（场景→表演→文字分镜→分镜图→成片） |
| 导出 | FDX/PDF/DOCX/TXT + 交付前检查 | 无专用导出；仅 `POST /api/export/:id` 的 `format:'json'` 能完整导出 |
| 图片/视频 | 挂到镜头 `refImage`，时间轴可预览 | 填 `storyboardImage` / `clip` URL，手动粘贴外部结果 |

## 四、接下来你可以做什么

1. **生成参考图**：打开「素材」页，把每个 `shot.visual` 复制到 prompt、把 `worldview.全局负面提示` 复制到 negativePrompt，用 qwen-image-3.0 生成；生成后把返回 URL 填到 Reel 的 `refs` 或 `storyboardImage`
2. **生成 30 秒成片（推荐·在 Cinema 内完成）**：进入本项目的「成片」阶段 →「生成成片」卡片会自动组装场景 + 表演 + 7 个镜头 + 负面提示为 prompt（可展开「查看将发送的 Prompt」核对）→ 选分辨率（480P 默认 / 720P / 1080P，费用按秒实时估算，30 秒 480P 约 ¥6.30）→ 点「生成成片」。任务完成后自动生成 V1 版本并回填为当前成片；再生成会累加 V2、V3…，可预览对比后「设为成片」，或复制 URL / 删除版本。网络抖动会退避重试，失败可「重新查询」，不会误判。
   - 手填外部 URL 仍可用：展开成片页底部的「或手动填入外部视频 URL / 路径」。
   - 也可在「素材」页用 wan3.0-video 生成（prompt 需自己拼），再把 URL 粘回 `clip`——适合想跨项目复用素材的场景。
3. **用 Reel 助手逐阶段细化**：右侧助手在"场景/表演/文字分镜"阶段各有预置提问（把场景写得更可拍摄、给这个表演设计 5 个镜头、检查连续性风险）
4. **导出**：Cinema 没有专用导出按钮；若要备份整个项目，在任意页面浏览器控制台调用 `fetch('/api/export/<项目id>', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({format:'json'})})` 下载完整 JSON
