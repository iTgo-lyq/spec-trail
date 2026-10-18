# Change 状态命令

常规状态修改使用 `node .agents/skills/spec-trail/scripts/change.mjs <命令> --change <id>`，规划在协作分支运行，移交后在登记的工作分支运行。Node.js 20+，仅使用内置模块，无需安装依赖。`--repo <仓库>` 可显式指定工作区；`--dry-run` 只输出拟写状态，不修改文档。`show` 按 ID 读取活动或归档 Change 的元数据，查找范围遵循[主 skill](../SKILL.md#入口与通用约束)。

脚本写入现有 `change.json`，不会替用户确认、运行测试、验证 Markdown 正文含义或自动提交/推送。摘要和来源由 Agent 根据真实证据填写；调用成功仅代表本地状态更新。任务默认按编号数值递增串行；Plan 可用显式执行顺序表覆盖，存在但无效时拒绝推进。顺序解析和前置链校验由共享 `scripts/task-order.mjs` 执行，正文任务定义和实际交付仍由 Agent 核对。依赖读取本地及 `origin` 跟踪分支，调用前按主 skill fetch；缺少已推送关闭记录时拒绝执行；若因 squash 等原因无法从祖先关系证明交付已集成，先核对所需代码/验证并写入 Execution，再用 `--availability-note '具体集成依据'` 继续。execute 及 xlarge 的 verify/accept/archive 接受该参数，输出前置主分支与当前 HEAD 的提交身份和依据，不把人工核对冒充祖先证明。

| 命令 | 参数与语义 |
| --- | --- |
| `create` | `--title --size`；可选 `--depends-on id,id`、`--parent id`、`--children id,id`、`--follow-up-of id`。首次命名延续组另传 `--group-title`，存入后继的 followUpTitle，后续通常省略并继承组名。在配置的协作分支建立 requirement 状态，不生成正文、不创建或切换 Git 分支、不覆盖已有目录；延续前序必须为已推送的有效归档。 |
| `follow-up` | `--target id/none`，可选 `--group-title`；为 active Change 设置直接前序或移除关联，沿前序链拒绝未归档、缺失、自指与循环。移除或更换前序时清除自身旧组名声明；无关联不可命名，显式名称不得与前序已有声明冲突。关联前读取整组名称，分叉同样沿用。不影响执行依赖、任务及确认，归档记录仍只读。 |
| `retitle` | `--title`；仅修改活动 Change 的展示标题，保留 id、阶段、任务与确认；需在所属分支运行。 |
| `confirm` | `--phase requirement/technical/plan/merge --summary --source`。summary 写阶段内容，优先 20–40 字符，最多 60 个 Unicode 码点、单句且不换行；source 写实际确认依据。需求确认进入 technical，large 技术确认进入 plan；执行另用 execute。medium/xlarge 技术与计划同次获确认时连续记录两次。merge 可附 `--source-commit --target-commit --base-commit`。 |
| `clarification-ask` | `--round --text --recommendation`；可选 `--question Qn`，默认下一个编号，只能递增。保存实际问过的需求或技术问题，round 为从 1 开始的正整数，同轮问题用同一值，跨阶段继续递增。 |
| `clarification-answer` | `--question Qn --answer`，可附 `--source`。保存用户最终有效回答，更正覆盖同题答案；未提供 source 时清除旧来源，实质改变需求或关键方案先按返工处理。 |
| `clarification-withdraw` | `--question Qn --reason`。保留原问答并记不再适用的原因，不退额度；撤回后不再回答，需要时新增问题。 |
| `task-add` | `--title`；可选 `--task Tn --branch`，默认分配下一个编号。完成任务不可覆盖，返修追加任务并更新 Plan。 |
| `task-start` | `--task Tn`；检查当前执行安排与整条前置链均已完成，再从 todo/blocked → doing，并移除旧阻塞原因。 |
| `task-block` | `--task Tn --reason`；保留任务定义，说明实际阻塞。 |
| `task-complete` | `--task Tn --verification`，可附 `--commit-title`；复核当前安排和前置链后 doing → done。先完成验证，再和实现一起提交推送。 |
| `task-retry` | `--task Tn`；只恢复尚未提交的 done 为 doing，移除验证/提交线索，用于提交失败；若同一任务已暂存为 done，同时只修正该任务的暂存内容，保留其余部分暂存差异。HEAD 中已 done 的任务不可回退；推送失败保留提交并重试推送。 |
| `execute` | 检查正文、任务执行安排、规模确认、前置归档与推送、单分支执行冲突，再进入 execution。 |
| `wait` / `resume` | wait 要求 `--kind confirmation/dependency/pause --summary`；实际等待条件解除后 resume 清除等待。resume 本身不授予确认或撤销取消。 |
| `rework` | `--stage requirement/technical/plan/execution --reason --approach`；返回最早受影响阶段，清除该阶段及之后的确认、merge 确认、关闭结果和等待；保留已完成任务。 |
| `verify` | `--result passed/failed --summary`；任务完成、执行安排有效且实际验证完成后进入 close，记录整体验证。后续 accept/specs/archive 也复核安排。独立评审要求仍按主 skill。 |
| `accept` | `--mode user/agent --summary --source`；验收方式按[主 skill](../SKILL.md#验收)，摘要与来源填写实际依据。 |
| `specs` | `--result synced/not_needed --summary`；验收后实际同步 Specs，再记录结果。 |
| `archive` | `--date YYYY-MM-DD --summary`；日期按用户时区提供；检查关闭前置后移动完整目录，记录 completed。必须在独立分支归档，随后提交推送并执行集成命令，不创建保留标签。 |
| `cancel` | `--reason`；保留阶段、任务、正文和代码，写取消原因并清除等待，分支冻结。 |
| `previews-set` | `--file /临时/entries.json`；文件只含 PreviewEntry 数组，替换关联而保留其他状态。新增/更新要求 enabled，hosted 校验引用与源码提交，Git 来源要求对应输出文件存在，停用后仍允许删除旧关联。 |

## 常用流程

确认摘要示例：requirement「支持浏览器多身份添加、切换和移除。」；technical「采用身份集合与两阶段切换，隔离读取并支持撤销。」；plan「先交付添加与切换，再完成移除和设备撤销。」；merge「保留新版身份机制，合并工作台改动。」。确认原话另填 source。

```bash
node .agents/skills/spec-trail/scripts/change.mjs create --change example --title '具体目标' --size small
# 按实际需求编辑 requirement.md，然后登记任务。
node .agents/skills/spec-trail/scripts/change.mjs task-add --change example --title '实现目标行为'
# 推送规划后移交；在目标 worktree 的执行会话继续，见 workspaces.md。
node .agents/skills/spec-trail/scripts/workspace.mjs handoff --change example
node .agents/skills/spec-trail/scripts/change.mjs execute --change example
node .agents/skills/spec-trail/scripts/change.mjs task-start --change example --task T1
# 完成实现与验证后，填真实结果；提交、推送与 done 一起完成。
node .agents/skills/spec-trail/scripts/change.mjs task-complete --change example --task T1 --verification '实际验证命令与结果'
node .agents/skills/spec-trail/scripts/change.mjs verify --change example --result passed --summary '实际整体验证与评审结论'
```

按主 skill 决定自验收或 `wait --kind confirmation`。人工验收通过后用 resume 清除等待；accept 记录真实依据，完成 Specs 同步后执行 specs，再 archive。需返修时使用 rework，保留已完成任务并追加返修任务。

## 时间与失败

问答命令不代替用户回答、不授予确认、不推进阶段或解除等待；支持在 active Change 补录创建前及先前会话问答，返工不清空记录。需求与技术共用连续 Q 编号和 round，额度分别计算、互不扣减，[技术问询](../SKILL.md#技术问询)使用独立的较小上限。Agent 按[问答记录](../SKILL.md#问答记录)在正文保留每题类别与 Q 引用，分别统计题数、每轮题数及不同 round 的数量；全局 round 较大不代表技术轮次已用尽。发问前核对所属类别额度，命令不拒绝记录已发生的超额问答。无问答时省略 clarifications；已有归档无需补写，旧确认摘要不追溯长度限制。

新时间统一为 UTC、三位毫秒 ISO 字符串；不接受 Agent 手填当前时间，不对读取端加时间容差。关闭步骤严格递增或相等，系统时钟早于前一步时拒绝写入，先核对时钟或实际历史记录。

每次操作持有 Git common-dir 内的仓库锁，JSON 通过同目录临时文件与 rename 写入，并检查写入前原文未被其他编辑器修改。重复创建/覆盖确认/重复完成/覆盖归档均拒绝；失败先查明原因，不通过手改 JSON 绕过前置校验。进程异常退出可能留下锁；确认持锁进程已结束、核对工作区后才能清理。归档涉及目录与 JSON 两次 rename，普通失败会回退；断电/强制杀进程时先结合 Git diff 检查文件与目录再恢复，不宣称具备跨文件事务保证。

正常操作不修改已归档或取消记录；历史勘误按[主 skill](../SKILL.md#文档与事实来源)处理。脚本尚未覆盖的语义先补充命令与验证，不使用通用任意字段 patch。
