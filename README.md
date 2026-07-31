# AI 生产力地图

AI Productivity Map 是一份中文优先、按实际任务组织的 AI 生产力工具目录。项目不追求收录数量或制造排名，而是提供简洁用途、适用场景、官方入口、访问方式、平台信息和最近复核日期。

线上站点：<https://loveyless.github.io/ai-productivity-map/>

## 本地开发

需要 Node.js 22.22.2 或更高版本和 npm。

```bash
npm ci
npm run dev
```

常用命令：

```bash
npm test                 # 运行 Vitest 测试
npm run check            # 运行 Astro / TypeScript 检查
npm run validate:catalog # 离线校验目录数据
npm run sync:brands      # 从官网元数据补齐缺失的本地品牌图标
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

品牌字段均为可选且可设为 `null`，没有充分官方证据时应保持为空：

- `brandIconPath`：仓库 `public/icons/` 下的本地图标 PNG 路径；图标会在入库前栅格化，并使用工具 ID 绑定的稳定/内容寻址文件名；
- `brandIconSourceUrl`：生成该本地图标时实际使用的官方 HTTPS URL；
- `brandIconSha256`：本地 PNG 字节的 SHA-256，用于防止证据与文件漂移；
- `brandIconReviewedAt`：图标来源、字节和本地文件最近被采纳或变更的日期；
- `brandThemeColor`：官网明确声明并规范化为六位十六进制的主题色；
- `brandThemeColorSourceUrl`：声明该主题色的官方页面或 web app manifest URL；
- `brandThemeColorReviewedAt`：主题色证据最近被采纳或变更的日期。

新增或修改记录时，请使用核查当天的 `YYYY-MM-DD` 日期，并确认链接指向产品所有者维护的官方页面。不要填写推测的免费额度、可用性保证、排名、用户数量或性能结论。

## 品牌资产同步

品牌同步脚本只读取工具的官方页面，图标依次采用 `apple-touch-icon`、页面 icon/favicon 元数据、官方 manifest 图标和官网源站 `/favicon.ico`。页面、Manifest、图标和每次重定向都必须留在该工具现有证据形成的已批准 host 集合内；新的跨域 CDN host 必须先人工核验，HTML `<base>` 不能扩大信任边界。主题色只采用页面 `theme-color`，其次采用官方 manifest 的 `theme_color`；不从类别或图标推断颜色。联网阶段执行公网地址校验和每工具绝对墙钟超时；远程位图和 ICO 会在可终止 Worker 内经过类型、体积、帧数、尺寸和解码检查，再统一栅格化为 96×96 的本地 PNG。自动同步拒绝 SVG，避免依赖不完整的 XML/CSS 清洗。发布阶段拒绝 symlink，使用内容寻址路径、完整 SHA-256、不可覆盖写入、协作单写者锁及 rename 后 fsync/readback。页面运行时不会热链远程图标。

```bash
npm run sync:brands                         # 只处理缺失或丢失的图标
npm run sync:brands -- --all                # 检查全部工具，保留已有验证值
npm run sync:brands -- --id chatgpt         # 精确选择一个或多个工具
npm run sync:brands -- --id chatgpt --refresh # 成功获取时刷新已有证据
npm run sync:brands -- --refresh            # 刷新全部工具
npm run sync:brands -- --all --dry-run      # 联网比较但不写入
npm run sync:brands -- --check              # 全量只读检查；若有变更或联网不确定则失败
npm run sync:brands -- --refresh --dry-run  # 明确请求比较已有品牌证据，但不写入
```

同步失败、访问受限或来源不明确时，必须保留已有验证数据不变；新工具则保持品牌字段为 `null`。不要改用 Google S2 favicon 聚合服务、Clearbit、Simple Icons、Iconify、百科镜像或其他第三方 logo 目录。日常 CI 只运行离线校验，不访问产品网站；联网同步应由维护者或后续定时维护代理显式运行并审阅结果。

## 搜索与筛选

页面在构建时渲染完整目录。浏览器端仅加载一段小型 TypeScript 控制器，根据名称、说明、适用场景、标签和平台执行规范化文本检索，再与类别筛选组合。核心逻辑在 [`src/lib/catalog.ts`](src/lib/catalog.ts)，由 Vitest 直接测试。

## 贡献

提交工具或纠正信息前，请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。建议先使用 Issue 表单提供官方来源、具体任务价值和需要更正的字段，再提交范围清晰的 Pull Request。

目录不接受付费置顶。收录也不等于背书；价格、功能、地区可用性和许可可能随时变化，采用前请复核官网。

产品名称与标识仅用于识别，相关商标归各自所有者所有。

定时维护的信息来源、自动修改范围、单次变更上限、品牌资源规则和发布质量门见 [`MAINTENANCE.md`](MAINTENANCE.md)。

## 校验与链接健康

`scripts/validate-catalog.mjs` 默认运行完全离线且结果确定，检查字段、类别覆盖、唯一 ID、唯一 URL、HTTPS、日期，以及本地图标的路径、存在性、体积、格式、尺寸和可解码性。只有传入 `--check-links` 时才联网。

联网检查会把 `401`、`403`、`429`、超时和服务器错误作为警告，因为这些状态常受反爬、限流或瞬时故障影响；确认的 `404`、`410` 和硬解析失败会使命令失败。该检查位于独立的定时/手动工作流中，不阻塞普通 CI。

## 部署

Astro 配置使用站点 `https://loveyless.github.io` 和项目基路径 `/ai-productivity-map`，输出为纯静态文件。

- `.github/workflows/ci.yml` 在 push 和 Pull Request 上运行安装、测试、离线目录校验、Astro 检查和构建。
- `.github/workflows/deploy-pages.yml` 在 `main` push 或手动触发时重新执行测试、离线目录校验、Astro 检查和构建，将 `dist/` 上传为 Pages artifact，再通过 GitHub Pages 官方部署 Action 发布。
- `.github/workflows/link-health.yml` 每周或手动执行联网检查，与必需 CI 分离。

GitHub 仓库的 Pages Source 需要设置为 **GitHub Actions**。项目不需要运行时 API、数据库、账号、分析脚本或 secrets。

## 许可证

本仓库当前未选择软件或内容许可证。许可证由项目所有者另行决定。
