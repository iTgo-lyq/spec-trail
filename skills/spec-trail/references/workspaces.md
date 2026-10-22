# 工作区与会话续接

需要 Node.js 20+ 和 Git，脚本仅依赖内置模块。Setup 提前准备 workflow v3、远端集成分支和主工作区；`--repo` 可从任意工作区指定仓库。后台直接使用接入时指定的集成分支，本地命令使用当前 checkout 的 workflow 并核对集成分支配置；两者只支持 workflow v3。

主工作区签出项目实际配置的集成分支（推荐名称 develop，可自定义），Change 和任务切换在各自 worktree 内进行。新工作区默认布局如下，项目名取主工作区目录名；Change 的工作区名默认使用 id：

```text
workspace/
├── project/                         # 主工作区，使用配置的集成分支
└── project-worktrees/
    ├── change-a/                    # 独立工作分支
    └── change-b/
```

构建与长期服务位置由项目约定决定；工作区隔离不要求迁移主工作区原有服务。

## 规划与移交

在集成分支用 `change.mjs` 整理需求与技术，移交后在所属分支继续 Plan、确认和任务。默认以 `git commit --only -m '<说明>' -- docs/project/changes/<id>` 限定提交范围，再普通推送，避免夹带其他会话的暂存内容。小补充的 amend 与回退按[主 skill](../SKILL.md#同阶段讨论的小补充)执行。普通推送非快进时保留现场，在独立工作区整合远端；除恢复本次 amend 外，不为推送切换或重置主工作区。分支移交始终使用普通提交和推送。

编写 Plan 前移交：需求已确认、Technical 已准备并推送；large 还需技术确认。无需先有 Plan、任务或已交付依赖，xlarge 也无需等待子项关闭。small 无 Plan，沿用需求、任务和依赖就绪后移交。

```bash
node .agents/skills/spec-trail/scripts/workspace.mjs handoff --change example --dry-run
node .agents/skills/spec-trail/scripts/workspace.mjs handoff --change example
```

默认工作分支 `change/<id>`，路径为主工作区同级的 `<项目名>-worktrees/<id>`；可用 `--branch`、`--path` 覆盖。已有登记和 Git worktree 优先复用。命令只在目标 worktree 内修改现有 change.json 的 branch，创建一个两端共享的登记提交，先推送目标，再正常快进推送集成分支；不替换目录、不添加指针文件或日志、不复制执行状态。它不授予阶段确认、不进入 execution。执行仍检查全部确认与依赖；需人工核对依赖交付时先记录证据，再传 `--availability-note`。

移交后在目标工作区编写 Plan，完成推送即按[PR 流程](integration.md)创建或复用 Draft，不等待计划确认。small 先提交推送真实执行状态再创建 Draft，不做空提交。

普通 Change 在集成分支不能进入 execution；移交后须在目标会话核验，获所需确认后运行 execute。xlarge 父项在工作分支聚合。状态命令拒绝改写其他分支所属的继承记录；show 使用集中入口，只有在所属分支才展示未推送的本地状态。

handoff 可重复调用。目标推送失败，集中入口保持原状；登记推送失败，目标保留登记提交供重试。相同 Change 的规划已变化、其他分支已取得登记、目标有额外提交或无关脏文件时保留现场并报错，不覆盖它们。允许重试因提交校验失败留下的、仅含预期 branch 修改的现场。并发不同 Change 的集中更新通过正常 Git 合并/快进重试协调；同一仓库使用既有状态操作锁，跨克隆依赖远端非快进检查。同一 worktree 的多个写入会话仍需协调。

主协作工作区干净时跟进快进，否则只报告未同步。进程中断后先检查 Git 状态与远端，再重试；遗留状态锁仅在确认原进程结束后清理。没有清除用户现场的自动恢复过程。

`--dry-run` 不创建工作区、提交、修改跟踪引用或推送。handoff 的预览会只读核对远端，必要引用尚未 fetch 时提示先定向 fetch；预览不是后续写操作的锁。

## 定位与续接

```bash
node .agents/skills/spec-trail/scripts/workspace.mjs locate --change example
node .agents/skills/spec-trail/scripts/workspace.mjs prepare --change example --dry-run
node .agents/skills/spec-trail/scripts/workspace.mjs prepare --change example
```

locate 只读本地跟踪引用，明确输出 freshness；它不是实时远端查询。prepare 定向 fetch 集成分支与登记的工作分支，缺失远端时拒绝使用残留跟踪引用；新克隆可从登记分支建立 worktree，已有工作区的未提交文件、领先提交、分叉均保留，不自动 reset/rebase。归档与取消记录可定位但不准备写入工作区。失效的 Git worktree 登记需先检查，不自动 prune。

输出包括集中入口/目标记录路径与提交、实际当前 cwd/分支、目标 worktree、ahead/behind、dirty、诊断和续接提示。会话始终标为 binding unverified：通用脚本不能验证宿主会话绑定。

客户端支持准确指定已有 worktree 时，优先复用已有执行会话，否则创建绑定它的新会话；交接只传路径、id、分支与从持久化记录恢复的步骤。若当前工具不暴露准确绑定/创建能力，向用户提供工作区路径和输出的续接提示，人工打开后核验实际 cwd、common-dir、分支和未推送差异。不能把子 agent、shell cd、创建 worktree 或模拟客户端调用当作已迁移当前会话。

工作分支交付前同步集成分支并验证，归档后按[集成与清理](./integration.md)通过已有 PR 合入并核实远端，再清理来源。xlarge 父项沿用工作分支关闭，不在集成分支直接归档。已集成的完整 completed 归档直接从集成分支读取，保留历史 branch；删除工作分支或 worktree 不影响该历史入口。发布分支发布只按用户主动要求执行，见主 skill 的合码规则。
