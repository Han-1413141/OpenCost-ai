# VBTI 图像来源

## 原创像素成就

`shared/assets/vbti-achievements-01.png` 使用内置图像生成工具于 2026-10-16 生成，作为 4×4 像素成就图集。主题包括种子、星章、日历、盾牌、终端、机器人、工具、传送门、书籍、烧瓶、调色盘、放大镜、星群、树、卷轴和宝箱。图集不包含第三方品牌标志；各格按 CSS 背景定位使用。

## 模型与 Harness 标志

<details><summary>成就图集生成提示词</summary>

```text
Use case: stylized-concept. Asset type: pixel-art sprite atlas for OpenCost VBTI achievement badges. Create ONE square 1024x1024 atlas, exactly 4 columns and 4 rows of 16 distinct small fantasy pixel-art achievement emblems centered at coordinates 128,384,640,896 in each axis. Every cell exactly 256x256, each emblem within center 160x160, leave equal clear margins; no grid lines. Flat solid pale cream #f6f0e6 background. Crisp richly detailed 16-bit pixel art, stepped edges, tasteful lilac/emerald/amber/blue, polished RPG inventory aesthetics. Reading order: glowing seed in a pot, bronze seven-point star medal, golden calendar with moon, platinum laurel shield; terminal with spark, tiny clockwork robot, crossed tools, glowing portal; stack of research books, crystal flask, purple paint palette, silver magnifying lens; chain of three stars, split branching tree, winged parchment, little treasure chest. Each badge has a distinct silhouette, subtle pixel shadow, no words, no letters, no numbers, no brand logos, no watermarks. Intended as decorative icons, not a screenshot of an interface.
```

</details>

`shared/assets/product-icons/` 中 SVG 来源于 [Lobe Icons](https://github.com/lobehub/lobe-icons)，固定提交 `8a1b2821bb768c484fe8da20c5e1838b6bf551a9`，路径 `packages/static-svg/icons/`。原项目的 MIT 许可保留于同目录 `LICENSE.txt`。

已使用：OpenAI、Claude、Claude Code、DeepSeek、Gemini、Qwen、OpenCode、Cursor、GitHub Copilot、Mistral、Kimi、ChatGLM。用于说明记录中的产品身份，不表示合作、赞助或官方认证。

保留 SVG 原始形状，在外围绘制像素边框，不对原标志进行像素重绘。[OpenAI 品牌指南](https://openai.com/brand/) 要求保持所提供标志原样；开源图标许可不替代各品牌的商标要求。未收录的 Harness 或模型使用文字与通用符号，不拿模型标志代替 Harness 标志。
