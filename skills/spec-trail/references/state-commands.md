# Change 状态命令

常规状态修改使用 `node .agents/skills/spec-trail/scripts/change.mjs <命令> --change <id>`，在 Change 主分支运行。Node.js 20+，仅使用内置模块，无需安装依赖。`--repo <仓库>` 可显式指定工作区；`--dry-run` 只输出拟写状态，不修改文档。`show` 可读取活动或归档记录。

脚本写入现有 `change.json`，不会替用户确认、运行测试、验证 Markdown 正文含义或自动提交/推送。摘要和来源由 Agent 根据真实证据填写；调用成功仅代表本地状态更新。任务默认按编号数值递增串行；Plan 可用显式执行顺序表覆盖，存在但无效时拒绝推进。顺序解析和前置链校验由共享 `scripts/task-order.mjs` 执行，正文任务定义和实际交付仍由 Agent 核对。依赖读取本地及 `origin` 跟踪分支，调用前按主 skill fetch；缺少已推送关闭记录时拒绝执行；若因 squash 等原因无法从祖先关系证明交付已集成，先核对所需代码/验证并写入 Execution，再用 `--availability-note '具体集成依据'` 继续。execute 及 xlarge 的 verify/accept/archive 接受该参数，输出前置主分支与当前 HEAD 的提交身份和依据，不把人工核对冒充祖先证明。

| 命令 | 参数与语义 |
| --- | --- |
| `create` | `--title --size`；可选 `--depends-on id,id`、`--parent id`、`--children id,id`。在当前非守护分支建立 requirement 状态，不生成正文、不创建或切换 Git 分支、不覆盖已有目录。 |
| `retitle` | `--title`；仅修改活动 Change 的展示标题，保留 id、阶段、任务与确认；需在所属分支运行。 |
| `confirm` | `--phase requirement/technical/plan/merge --summary --source`。记录已有明确确认；需求确认进入 technical，large 技术确认进入 plan；执行另用 execute。medium/xlarge 技术与计划同次获确认时连续记录两次。merge 可附 `--source-commit --target-commit --base-commit`。 |
| `task-add` | `--title`；可选 `--task Tn --branch`，默认分配下一个编号。完成任务不可覆盖，返修追加任务并更新 Plan。 |
| `task-start` | `--task Tn`；检查当前执行安排与整条前置链均已完成，再从 todo/blocked → doing，并移除旧阻塞原因。 |
| `task-block` | `--task Tn --reason`；保留任务定义，说明实际阻塞。 |
| `task-complete` | `--task Tn --verification`，可附 `--commit-title`；复核当前安排和前置链后 doing → done。先完成验证，再和实现一起提交推送。 |
| `task-retry` | `--task Tn`；只恢复尚未提交的 done 为 doing，移除验证/提交线索，用于提交失败；若同一任务已暂存为 done，同时只修正该任务的暂存内容，保留其余部分暂存差异。HEAD 中已 done 的任务不可回退；推送失败保留提交并重试推送。 |
| `execute` | 检查正文、任务执行安排、规模确认、前置归档与推送、单分支执行冲突，再进入 execution。 |
| `wait` / `resume` | wait 要求 `--kind confirmation/dependency/pause --summary`；实际等待条件解除后 resume 清除等待。resume 本身不授予确认或撤销取消。 |
| `rework` | `--stage requirement/technical/plan/execution --reason --approach`；返回最早受影响阶段，清除该阶段及之后的确认、merge 确认、关闭结果和等待；保留已完成任务。 |
| `verify` | `--result passed/failed --summary`；任务完成、执行安排有效且实际验证完成后进入 close，记录整体验证。后续 accept/specs/archive 也复核安排。独立评审要求仍按主 skill。 |
| `accept` | `--mode user/agent --summary --source`；agent 仅允许 small；user 必须有用户实际验收或明确交付/合入授权。明确要求人工验收时不可用 agent 代替。 |
| `specs` | `--result synced/not_needed --summary`；验收后实际同步 Specs，再记录结果。 |
| `archive` | `--date YYYY-MM-DD --summary`；日期按用户时区提供；检查关闭前置后移动完整目录，记录 completed。携带 previews 时输出原型保留标签后续命令。 |
| `cancel` | `--reason`；保留阶段、任务、正文和代码，写取消原因并清除等待，分支冻结。 |
| `previews-set` | `--file /临时/entries.json`；文件只含 PreviewEntry 数组，替换关联而保留其他状态。新增/更新要求 enabled，hosted 校验引用与源码提交，Git 来源要求对应输出文件存在，停用后仍允许删除旧关联。 |

## 常用流程

```bash
node .agents/skills/spec-trail/scripts/change.mjs create --change example --title '具体目标' --size small
# 按实际需求编辑 requirement.md，然后登记任务。
node .agents/skills/spec-trail/scripts/change.mjs task-add --change example --title '实现目标行为'
node .agents/skills/spec-trail/scripts/change.mjs execute --change example
node .agents/skills/spec-trail/scripts/change.mjs task-start --change example --task T1
# 完成实现与验证后，填真实结果；提交、推送与 done 一起完成。
node .agents/skills/spec-trail/scripts/change.mjs task-complete --change example --task T1 --verification '实际验证命令与结果'
node .agents/skills/spec-trail/scripts/change.mjs verify --change example --result passed --summary '实际整体验证与评审结论'
```

需要等待人工验收时使用 wait。用户已明确验收或授权交付/合入时，以实际原话填写 accept 的 source；small 自验收在 summary 标明“Agent 自验收”及逐项依据。完成 Specs 同步后执行 specs，再 archive；脚本不替这些实际步骤提供证据。

## 时间与失败

新时间统一为 UTC、三位毫秒 ISO 字符串；不接受 Agent 手填当前时间，不对读取端加时间容差。关闭步骤严格递增或相等，系统时钟早于前一步时拒绝写入，先核对时钟或实际历史记录。

每次操作持有 Git common-dir 内的仓库锁，JSON 通过同目录临时文件与 rename 写入，并检查写入前原文未被其他编辑器修改。重复创建/覆盖确认/重复完成/覆盖归档均拒绝；失败先查明原因，不通过手改 JSON 绕过前置校验。进程异常退出可能留下锁；确认持锁进程已结束、核对工作区后才能清理。归档涉及目录与 JSON 两次 rename，普通失败会回退；断电/强制杀进程时先结合 Git diff 检查文件与目录再恢复，不宣称具备跨文件事务保证。

正常操作不修改已归档或取消记录。用户明确要求历史勘误时，核实事实后在所属分支做最小修正，以独立提交说明原因，不改写已推送 Git 历史。脚本尚未覆盖的语义先补充命令与验证，不使用通用任意字段 patch。
