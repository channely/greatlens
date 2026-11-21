# 细胞器 GLB 生成配方（Polyspoon）

模型由 Polyspoon toolkit 的 `slime` family 参数化生成。工具包安装在 `.polyspoon/`（gitignore，本地缓存），
首次生成需：

```bash
# 1. 下载 agent bundle（https://polyspoon.com/agent-bundles/polyspoon-agent-4.zip）并用 install.mjs 安装
node .tmp-polyspoon/toolkit/install.mjs --project . --app claude
node .polyspoon/bootstrap.mjs

# 2. 生成单个模型（输出目录必须不存在）
node .polyspoon/runtime.mjs build --family slime \
  --parameters '{"form":"dome","mood":"angry","crown":true,"color.body":"#8b5cf6"}' \
  --out public/models/nucleus
```

已固化的四个模型配方见 `public/models/*/asset.design.json`，可用
`node .polyspoon/runtime.mjs build --config public/models/nucleus/asset.design.json --out <新目录>` 复现。

设计取舍：Polyspoon 现有 141 个模型均为低模道具（长凳、橡树、狐狸等），无细胞器/生物模型；
故用带表情的 `slime` recipe 参数化出**风格化拟人细胞器**，与「我是不白吃」扁平科普画风一致。
这是叙事角色而非解剖学模型。
