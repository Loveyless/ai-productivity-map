# AI 生产力地图

AI Productivity Map 是一份中文优先、按实际任务组织的 AI 生产力工具目录。项目不追求收录数量或制造排名，而是提供简洁用途、适用场景、官方入口、访问方式、平台信息和最近复核日期。

线上站点：<https://loveyless.github.io/ai-productivity-map/>

## 本地开发

需要 Node.js 22 和 npm。

```bash
npm ci
npm run dev
```

常用命令：

```bash
npm test                 # 运行 Vitest 测试
npm run check            # 运行 Astro / TypeScript 检查
npm run validate:catalog # 离线校验目录数据
npm run build            # 构建静态站点到 dist/
npm run preview          # 本地预览生产构建
npm run validate:links   # 可选：联网检查官方链接
```

## 内容模型

目录的唯一内容源是 [`src/data/catalog.json`](src/data/catalog.json)。类别和工具记录都在这个文件中，便于审阅和手工维护。显式 TypeScript 类型及站内运行时校验位于 [`src/data/catalog.ts`](src/data/catalog.ts)。

每个工具包含：

- 稳定且唯一的 `id`、名称和官方 HTTPS URL；
- 简洁能力说明和最适合的任务场景；
- 一个已声明类别、检索标签和支持平台；
- 保守的访问/订阅描述，不写未经核实的价格或保证；
- `openSource`、`local` 指示和 `reviewedAt` 复核日期。

新增或修改记录时，请使用核查当天的 `YYYY-MM-DD` 日期，并确认链接指向产品所有者维护的官方页面。不要填写推测的免费额度、可用性保证、排名、用户数量或性能结论。

## 搜索与筛选

页面在构建时渲染完整目录。浏览器端仅加载一段小型 TypeScript 控制器，根据名称、说明、适用场景、标签和平台执行规范化文本检索，再与类别筛选组合。核心逻辑在 [`src/lib/catalog.ts`](src/lib/catalog.ts)，由 Vitest 直接测试。

## 贡献

提交工具或纠正信息前，请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。建议先使用 Issue 表单提供官方来源、具体任务价值和需要更正的字段，再提交范围清晰的 Pull Request。

目录不接受付费置顶。收录也不等于背书；价格、功能、地区可用性和许可可能随时变化，采用前请复核官网。

## 校验与链接健康

`scripts/validate-catalog.mjs` 只使用 Node.js 标准库。默认运行完全离线且结果确定，检查字段、类别覆盖、唯一 ID、唯一 URL、HTTPS、日期和目录规模。只有传入 `--check-links` 时才联网。

联网检查会把 `401`、`403`、`429`、超时和服务器错误作为警告，因为这些状态常受反爬、限流或瞬时故障影响；确认的 `404`、`410` 和硬解析失败会使命令失败。该检查位于独立的定时/手动工作流中，不阻塞普通 CI。

## 部署

Astro 配置使用站点 `https://loveyless.github.io` 和项目基路径 `/ai-productivity-map`，输出为纯静态文件。

- `.github/workflows/ci.yml` 在 push 和 Pull Request 上运行安装、测试、离线目录校验、Astro 检查和构建。
- `.github/workflows/deploy-pages.yml` 在 `main` push 或手动触发时构建，将 `dist/` 上传为 Pages artifact，再通过 GitHub Pages 官方部署 Action 发布。
- `.github/workflows/link-health.yml` 每周或手动执行联网检查，与必需 CI 分离。

GitHub 仓库的 Pages Source 需要设置为 **GitHub Actions**。项目不需要运行时 API、数据库、账号、分析脚本或 secrets。

## 许可证

本仓库当前未选择软件或内容许可证。许可证由项目所有者另行决定。
