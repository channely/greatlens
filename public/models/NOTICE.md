# 虚拟制片 3D 模型许可与来源说明

本目录的模型由 [Polyspoon](https://polyspoon.com/) 开源 toolkit（Apache-2.0）在本地生成，
基于其 `slime` recipe family，通过参数化 controls 调整形态、颜色与表情，作为科普短视频
「细胞器对话」的**风格化角色**（并非科学精确的解剖模型）。

- 生成器：Polyspoon agent bundle 4（Apache-2.0），本项目内 `.polyspoon/`（运行时缓存，不入库）。
- 每个模型目录含：
  - `asset.glb` — glTF 2.0 二进制，米制，+Y up；
  - `asset.controls.json` — 全部控制项的范围、默认值、单位与应用值；
  - `asset.design.json` — 可复现的设计文件，可用 toolkit 重新构建。
- 角色映射（风格化拟人，非专业生物模型）：
  - `nucleus` 细胞核：紫色、冠冕、严肃表情；
  - `mitochondrion` 线粒体：红色、外壳、开心表情；
  - `ribosome` 核糖体：黄色小体；
  - `membrane` 细胞膜片段：蓝色扁平体。
- 许可：Polyspoon toolkit 与引擎为 Apache-2.0；生成的几何体在本项目中使用，保留本说明与 toolkit 的 LICENSE/NOTICE。
- NVIDIA 通道：`catalog.json` 预留 `source: "nvidia"` 项，但当前无符合许可与格式的官方细胞器资产；
  第三方许可证不明的模型不得接入。

如需重新生成，见 `assets/virtual/README.md`。
