# Skill Workbench

Skill Workbench 是一个本地优先的 Agent Skill 管理工作台。

如果你经常给 AI 助手写提示词、整理工作流、沉淀操作规范，最后很容易遇到一个问题：这些能力散落在不同项目、不同工具、不同文件夹里，时间久了就不好找、不好复用，也不知道哪个项目到底启用了哪些能力。

这个项目就是为了解决这件事：把可复用的 AI 工作方法整理成一个个 `Skill`，统一放进 `skills/` 源码池，再用一个本地 dashboard 浏览、搜索、导入、同步和按项目启用。

## 一句话解释

你可以把 Skill Workbench 理解成：

```text
一个给 AI 助手用的“技能库管理器”。
```

它不是聊天机器人，也不是云服务。它更像一个本地工具箱，帮你管理这些东西：

- 哪些 Skill 已经收集好了；
- 每个 Skill 是干嘛的；
- 哪些 Skill 来自 GitHub；
- 哪些 Skill 可以同步更新；
- 某个项目应该启用哪些 Skill；
- 怎么把 Skill 链接到项目里，而不是全局乱开。

## 什么是 Skill？

在这个项目里，一个 Skill 通常就是一个文件夹，里面至少有一个 `SKILL.md`：

```text
skills/example-skill/
└── SKILL.md
```

你可以把它理解成一份“给 AI 助手看的专业说明书”。

比如你可以有这些 Skill：

- 写公众号文章的 Skill；
- 做竞品分析的 Skill；
- 生成网页原型的 Skill；
- 调试代码的 Skill；
- 做图片提示词的 Skill；
- 处理某个公司内部流程的 Skill。

每个 Skill 会告诉 AI：什么时候应该使用它、应该遵守什么流程、需要读取哪些参考文件、输出结果应该是什么样。

## 这个项目适合谁？

如果你是新手，只需要记住：只要你有一些反复使用的 AI 工作方法，这个项目就可能有用。

典型场景包括：

- 你经常把同一套提示词复制到不同项目里；
- 你有很多自己整理的工作流，不知道怎么统一管理；
- 你不想把所有 Skill 都全局启用，只想让某个项目启用它真正需要的几个；
- 你想从 GitHub 上收集别人公开的 Skill，但希望先审核再使用；
- 你想做一个本地 Skill 知识库，让自己或团队更容易复用 AI 工作经验。

如果你已经会一点命令行，这个项目可以直接用。如果你完全没接触过命令行，也可以先把它当成一个本地网页 dashboard 来理解：命令只是用来生成和启动这个 dashboard。

## 它解决的核心问题

### 1. Skill 太分散

没有统一管理时，Skill 可能散落在：

```text
项目 A/.agents/skills
项目 B/.claude/skills
某个下载目录
某个笔记文件夹
某个 GitHub 仓库
```

结果就是找不到、版本混乱、重复复制。

Skill Workbench 的做法是：先统一放进一个源池。

```text
skills/
├── example-skill/
│   └── SKILL.md
└── another-skill/
    └── SKILL.md
```

### 2. 不想所有项目都加载所有 Skill

有些 Skill 只适合写作项目，有些只适合前端项目，有些只适合内部流程。如果全部全局启用，AI 可能会误触发不相关的规则。

Skill Workbench 支持按项目启用：

```bash
node scripts/skill-workbench.mjs enable /path/to/project example-skill
```

这样某个项目只会链接它需要的 Skill。

### 3. 想看清 Skill 来源

公开 Skill 可能来自不同 GitHub 仓库。这个项目用 `_manifests/source-rules.json` 记录来源规则，让 dashboard 能知道哪些 Skill 有明确上游，哪些可以显式同步。

### 4. 想有一个可视化入口

运行重建命令后，会生成：

```text
skills-index.json
dashboard.html
```

你可以打开 `dashboard.html`，用网页方式查看 Skill 列表、分类、来源、详情和项目启用状态。

## 目录结构说明

```text
.
├── skills/                         # Skill 源码池，所有公开 Skill 放这里
├── scripts/
│   └── skill-workbench.mjs          # 主脚本：生成 dashboard、导入、同步、项目启用
├── tests/
│   └── skill-workbench.test.mjs     # 自动化测试
├── _manifests/
│   ├── source-rules.json            # GitHub 来源映射规则
│   └── zh-descriptions.json         # 中文说明缓存
├── skills-index.json                # 自动生成的 Skill 索引
├── dashboard.html                   # 自动生成的本地 dashboard 页面
├── package.json                     # 常用 npm 命令
└── AGENTS.md                        # 本仓库协作规则
```

新手重点看这几个就够了：

- `skills/`：Skill 放在哪里；
- `dashboard.html`：打开后看 Skill；
- `scripts/skill-workbench.mjs`：所有命令的入口；
- `README.md`：也就是你正在看的说明。

## 快速开始

### 第 1 步：准备环境

你需要安装：

- Node.js 18 或更新版本；
- Git。

检查是否安装成功：

```bash
node --version
git --version
```

如果能看到版本号，说明基础环境没问题。

### 第 2 步：生成 dashboard

在项目根目录运行：

```bash
node scripts/skill-workbench.mjs rebuild-source
```

成功后会看到类似输出：

```text
skills=1
confirmedSources=0
unconfirmedSources=1
json=/path/to/skills-index.json
html=/path/to/dashboard.html
```

这表示 Skill 索引和 dashboard 已经生成。

### 第 3 步：打开 dashboard

你可以直接打开这个文件：

```text
dashboard.html
```

如果只是浏览 Skill，直接打开静态文件就够了。

如果你需要在页面里使用“导入 Skill”“同步 Skill”“移除 Skill”“项目启用 Skill”等按钮，需要启动本地服务：

```bash
node scripts/skill-workbench.mjs serve
```

脚本会输出一个地址，例如：

```text
url=http://127.0.0.1:37821/dashboard.html
```

用浏览器打开这个地址即可。

## 常用命令

### 重新生成索引和页面

当你新增、删除或修改 Skill 后，运行：

```bash
node scripts/skill-workbench.mjs rebuild-source
```

它会更新：

- `skills-index.json`
- `dashboard.html`

### 启动本地 dashboard 服务

```bash
node scripts/skill-workbench.mjs serve
```

需要导入、同步、删除或项目启用 Skill 时，用这个命令。

### 查看缺少中文说明的 Skill

```bash
node scripts/skill-workbench.mjs list-missing-zh
```

这个命令适合维护中文 dashboard 时使用。

### 初始化某个项目的 Skill 工作区

```bash
node scripts/skill-workbench.mjs init-project /path/to/project
```

它会在目标项目里创建 `.agents/skills` 相关结构。

### 给某个项目启用 Skill

```bash
node scripts/skill-workbench.mjs enable /path/to/project example-skill
```

启用后，目标项目会通过链接引用本仓库里的 Skill，而不是复制一份过去。

### 禁用某个项目里的 Skill

```bash
node scripts/skill-workbench.mjs disable /path/to/project example-skill
```

这只会移除目标项目里的链接，不会删除源池里的 Skill。

### 检查项目 Skill 链接是否健康

```bash
node scripts/skill-workbench.mjs check /path/to/project
```

如果有链接断掉或目录结构异常，这个命令会报告出来。

### 运行测试

```bash
node --test tests/skill-workbench.test.mjs
```

或者：

```bash
npm test
```

## 怎么添加一个自己的 Skill？

最简单的方式是新建一个文件夹：

```text
skills/my-first-skill/
└── SKILL.md
```

`SKILL.md` 可以先写成这样：

```markdown
---
name: my-first-skill
description: 用于演示我的第一个 Skill。
---

# My First Skill

当用户需要演示 Skill Workbench 的基本流程时，使用这个 Skill。

## Workflow

1. 先理解用户目标。
2. 给出最小可执行步骤。
3. 输出简洁、清晰、可验证的结果。
```

然后运行：

```bash
node scripts/skill-workbench.mjs rebuild-source
```

再打开 `dashboard.html`，你就能看到这个新 Skill。

## 静态页面和本地服务有什么区别？

直接打开 `dashboard.html` 时，它只是一个静态页面，适合浏览、搜索和查看详情。

启动本地服务后：

```bash
node scripts/skill-workbench.mjs serve
```

页面可以调用本地接口，所以能做更多操作，例如：

- 从 GitHub 扫描并导入 Skill；
- 同步已有 Skill；
- 移除 Skill；
- 查看项目 Skill 状态；
- 给项目启用或禁用 Skill。

简单说：

```text
只看：打开 dashboard.html
要操作：运行 serve
```

## 哪些目录不要提交？

下面这些通常是本地缓存、备份或运行时目录，不应该提交到 Git：

```text
_backups/
_legacy/
_logs/
_repos/
_tmp/
output/
.agents/
.claude/
```

这个仓库的 `.gitignore` 已经默认忽略它们。

## 这个公开仓库和私有源库是什么关系？

这个公开仓库是从一个私有源库导出的干净版本。

公开仓库只保留：

- Skill Workbench 工具本体；
- 示例 Skill；
- 可以公开的文档、测试和生成页面。

不会包含：

- 私人 Skill；
- 本地备份；
- GitHub 缓存仓库；
- 临时文件；
- 个人机器路径；
- API key、cookie、token 等凭据。

这样做的好处是：公开仓库可以给别人学习和使用，私有源库仍然可以继续维护个人内容。

## 常见问题

### 这是一个 AI 应用吗？

不是。它不是聊天界面，也不直接替你调用大模型。

它是一个管理 Agent Skills 的本地工作台。你可以把它理解成 AI 工作流的资料库、索引器和项目启用工具。

### 我不会写代码，可以用吗？

可以，但至少需要会运行几条命令。

最常用的只有两条：

```bash
node scripts/skill-workbench.mjs rebuild-source
node scripts/skill-workbench.mjs serve
```

第一条生成页面，第二条启动本地服务。

### Skill 是不是只能给某一个 AI 工具用？

不是。`SKILL.md` 本质上是结构化的说明文档。不同 Agent 工具可能有不同加载方式，但这套源池和 dashboard 的管理思路是通用的。

### 为什么不把所有 Skill 都全局启用？

因为 Skill 越多，越容易互相干扰。一个写作项目不一定需要代码调试 Skill，一个前端项目也不一定需要营销文案 Skill。

更稳的方式是：统一收集，按项目启用。

### 修改 Skill 后为什么 dashboard 没变？

因为 `dashboard.html` 和 `skills-index.json` 是生成文件。修改 Skill 后需要重新运行：

```bash
node scripts/skill-workbench.mjs rebuild-source
```

### 可以从 GitHub 导入别人的 Skill 吗？

可以。启动本地服务后，dashboard 里有导入入口。它会扫描包含 `SKILL.md` 的目录，并让你选择要导入哪些 Skill。

### 这个项目会自动联网同步吗？

不会在页面加载时自动联网。只有你明确点击同步按钮，或者运行相关命令时，才会检查远端仓库。

## 开发与验证

修改代码或文档后，建议运行：

```bash
npm run check
```

它会执行：

```bash
npm run build
npm test
git diff --check
```

也可以分别运行：

```bash
node scripts/skill-workbench.mjs rebuild-source
node --test tests/skill-workbench.test.mjs
git diff --check
```

## 许可证

MIT
