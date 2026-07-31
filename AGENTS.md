# AGENTS.md

## 项目规则

- 保持 Astro 静态输出、Node 22 和 npm；不要引入后端、运行时 API、分析、跟踪、账号或 secrets。
- 保留 GitHub Pages 配置：`site` 为 `https://loveyless.github.io`，`base` 为 `/ai-productivity-map`。
- 目录内容只编辑 `src/data/catalog.json`，类型与校验契约在 `src/data/catalog.ts`。
- 使用中文优先、可核查且保守的文案。只链接官方 HTTPS 页面，不写未经证实的额度、价格、保证、排名、用户量或基准结论。
- 每次内容修改都更新对应工具的 `reviewedAt`，格式为 `YYYY-MM-DD`。
- 搜索/筛选行为保持为 `src/lib/catalog.ts` 中的纯函数。非平凡行为严格按 RED -> GREEN -> REFACTOR：先写测试并运行确认预期失败，再实现。
- 保持语义化 HTML、键盘可用性、清晰焦点、对比度和 `prefers-reduced-motion` 支持。
- 不添加 LICENSE 文件，也不要代替所有者选择软件或内容许可证。
- 保持依赖精简；不要加入大型 UI 框架。

## 完成前验证

```bash
npm test
npm run validate:catalog
npm run check
npm run build
```

链接修改后可额外运行 `npm run validate:links`。网络告警需要人工判断，不得把联网检查加入普通必需 CI。
