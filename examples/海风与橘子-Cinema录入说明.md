# 《海风与橘子》Cinema 录入说明

项目已创建在本地（项目名 `海风与橘子 Cinema`），打开 http://127.0.0.1:8787 → 「项目」→ 该项目 → 进入 Cinema 工作台即可看到。

## 一、关键设计决策：为什么拆成 2 个 Reel

Cinema 工作台是**固定 15 秒 / Reel** 的短片流水线（界面顶栏与成片阶段都写死"15 秒/Reel"，数据里的 `duration` 字段不参与显示）。30 秒剧本必须拆成 2 个 Reel：

| Reel | 时间 | 镜头 | 相位 | 连续性 |
|---|---|---|---|---|
| Reel 1 · 摘帽与抛橘 | 0–15s | 镜头1 大全景建立(4s) + 镜头2 摘帽(4s) + 镜头3 抛橘(4s) + **衔接特写(3s)** | `last-frame`（末帧接续） | 结尾定格弟弟接住橘子的手，作为 Reel 2 起点 |
| Reel 2 · 告别与驶离 | 15–30s | 镜头4 挥手告别(5s) + 镜头5 驶离(7s) + 镜头6 淡出(3s，从原6s压缩) | `natural`（自然过渡） | 承接橘子，结尾音乐收尾 |

> 我在镜头3和4之间**加了一个 3 秒的衔接特写**（弟弟接住橘子、指尖收紧、末帧定格），这是原剧本没有但 Cinema 末帧接续需要的画面锚点。若你不需要，删掉 Reel 1 的第 4 个镜头并把镜头3的 `time` 改成 `8-15s` 即可。

## 二、字段映射

### 项目级 `film`（Cinema 专属）
| 字段 | 填入内容 | UI 可见性 |
|---|---|---|
| `orientation` | `landscape`（16:9 横屏） | 顶栏显示"横屏 · 15秒/Reel" |
| `productionType` | `animation`（动画短片） | 无 UI，仅数据 |
| `cameraStyle` | 六个镜头的运动方式串接 | 无 UI，但会进 AI 上下文 |
| `artStyle` | 日系动画电影质感、黄昏暖橙、金色反光、16:9 | 无 UI，但会进 AI 上下文 |

### 项目级 `worldview`（8 条）
画幅、片长、风格、情绪基调、主场景、核心意象、**全局负面提示**都放这里。Cinema 项目默认 `worldview: {}`，但 AI 助手发问时会把整个项目（含 worldview）作为上下文带给模型，所以负面提示不会丢。

### 角色 / 地点 / 道具
与 Script 版相同：沈岚、沈屿写入 `characters`，近海码头写入 `locations`，白帽与橘子写入 `props` 且带 `continuity` 字段——Cinema 助手的"检查连续性风险"提问会用到。

### Reel 内字段
| 阶段 | 字段 | 填入内容 |
|---|---|---|
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
| 时间单位 | `shots` 带独立 duration，时间轴自适应 | 固定 15s/Reel，镜头用 `time` 字符串描述秒段 |
| 事实来源 | `episodes[0].nodes`（语义节点） | `reels[].performance`（表演描述） |
| 阶段 | 9 个平铺 tab | 5 阶段流水线（场景→表演→文字分镜→分镜图→成片） |
| 导出 | FDX/PDF/DOCX/TXT + 交付前检查 | 无专用导出；仅 `POST /api/export/:id` 的 `format:'json'` 能完整导出 |
| 图片/视频 | 挂到镜头 `refImage`，时间轴可预览 | 填 `storyboardImage` / `clip` URL，手动粘贴外部结果 |

## 四、接下来你可以做什么

1. **生成参考图**：打开「素材」页，把每个 `shot.visual` 复制到 prompt、把 `worldview.全局负面提示` 复制到 negativePrompt，用 qwen-image 生成；生成后把返回 URL 填到 Reel 的 `refs` 或 `storyboardImage`
2. **生成视频**：在素材页用文生视频，把 `shot.visual` + 镜头运动拼成 prompt，`ratio` 选 16:9、`negativePrompt` 同上；成片 URL 填到 `clip`
3. **用 Reel 助手逐阶段细化**：右侧助手在"场景/表演/文字分镜"阶段各有预置提问（把场景写得更可拍摄、给这个表演设计 5 个镜头、检查连续性风险）
4. **导出**：Cinema 没有专用导出按钮；若要备份整个项目，在任意页面浏览器控制台调用 `fetch('/api/export/<项目id>', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({format:'json'})})` 下载完整 JSON
