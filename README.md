# SpecTrail

A Git-native, spec-driven workflow for coding agents.

SpecTrail 是一套 Agent Skill，用 Git 和 `docs/project/` 管理需求、技术方案、计划、执行、验收及归档。每个 Change 的流程状态由 `change.json` 维护，正文和验证证据保存在 Markdown 中。

产品介绍站区分 Skill、OpenFolio 工作台与原型管理。网站源码及 Cloudflare Pages 发布说明见 [website/README.md](website/README.md)。

## 安装

在需要使用 SpecTrail 的 Git 项目根目录执行：

```bash
npx skills add iTgo-lyq/spec-trail --skill spec-trail --agent codex --copy -y
```

安装位置为项目内的 `.agents/skills/spec-trail/`。主 skill、`setup/`、`prototype/` 和共享脚本一起安装，并可随项目提交。当前版本的脚本调用约定使用这个项目内路径，请使用上述安装方式。

也可以为其他支持 Agent Skills 的客户端安装，例如：

```bash
npx skills add iTgo-lyq/spec-trail --skill spec-trail --agent claude-code --copy -y
```

安装后确认项目内 `.agents/skills/spec-trail/` 包含完整目录，其他客户端的入口由安装器管理。工作流由 Agent 执行，脚本校验流程状态、原型发布引用和 Git 兜底产物。

更新项目内安装：

```bash
npx skills update spec-trail -p -y
```

## 环境要求

- Git。
- Node.js 20+ 用于状态命令和接入校验；使用原型功能时需要 Node.js 24+，建议统一使用 Node.js 24 或更新版本。
- 能读取本地 Skill 文件、运行命令并操作 Git 的编码 Agent。

状态和接入脚本只使用 Node.js 内置模块。可选的原型浏览器验证使用业务项目中的 Playwright，详见原型子 skill。

## 开始使用

在 Codex 中可以直接提出：

```text
使用 $spec-trail 为当前项目接入工作流，检查默认分支和现有提交校验。
```

接入完成后，用具体目标启动工作，例如：

```text
使用 $spec-trail 实现导出功能，先整理需求和验收条件。
```

Agent 会按任务规模整理文档、确认必要的决策并推进 Change。状态修改使用随 skill 提供的语义命令；直接查看命令说明请读 [state-commands.md](skills/spec-trail/references/state-commands.md)。

## 工作流

| 能力 | 交付 |
| --- | --- |
| 需求与方案 | 目标、范围、行为变化、技术取舍和验收条件 |
| 计划与执行 | 任务、依赖、分支和实际验证证据 |
| 状态操作 | `change.json` 的语义命令及共享字段校验 |
| 接入检查 | 只读环境检查，以及业务项目现有 hook 的接入指导 |
| 关闭与归档 | 验证、验收、Specs 同步和完整 Change 历史；归档后询问直接合入或发起 PR，沿用已有明确选择 |
| 可选原型 | 宿主构建与托管、main 当前清单、Change 固定版本引用，以及 Git 单 HTML 兜底 |

业务项目中的文档结构：

```text
docs/project/
├── workflow.json
├── specs/<capability-path>/spec.md
├── changes/<change-id>/
│   ├── change.json
│   └── 按规模和阶段创建的 Markdown 正文
└── archive/YYYY-MM-DD-<change-id>/
```

本仓库的分发包：

```text
skills/spec-trail/
├── SKILL.md
├── LICENSE
├── references/
├── scripts/
├── setup/
│   ├── SKILL.md
│   ├── scripts/
│   └── tests/
└── prototype/
    ├── SKILL.md
    ├── scripts/
    ├── examples/
    └── assets/
```

`setup` 和 `prototype` 是随主 skill 分发的子目录，主工作流按需读取。

完整规则以 [主 skill](skills/spec-trail/SKILL.md)、[接入子 skill](skills/spec-trail/setup/SKILL.md) 和 [原型子 skill](skills/spec-trail/prototype/SKILL.md) 为准。Skill 指令当前使用中文；工作流支持单个 Git 仓库及同仓库的分支和 worktree。

## 维护与验证

修改 skill 时保留整个分发包及其相对引用。在本仓库根目录运行现有接入和提交校验测试：

```bash
node --test skills/spec-trail/setup/tests/setup.test.mjs
```

这个测试集验证接入检查、提交 hook、状态字段、暂存区、部分提交、clone 和 worktree。它不代表所有 Agent 工作流或原型交互都已完成端到端验证。

问题与改进建议请提交到 [GitHub Issues](https://github.com/iTgo-lyq/spec-trail/issues)。

## License

[MIT](LICENSE) © 2026 iTgo。
