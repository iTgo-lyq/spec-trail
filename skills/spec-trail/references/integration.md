# Change PR 集成与清理

Plan 在工作分支写完并推送后，通过平台工具创建或复用同仓库 Draft PR，目标为 integrationBranch，不等待计划确认。small 无 Plan，在移交并推送真实执行状态后、实施前创建。正文说明范围，末尾独立段落写：

```text
SpecTrail-Change: example
```

按仓库、源目标分支和标记匹配已有 PR；有歧义先核实。后续推送同一源分支自动更新 diff，交付时更新同一 PR 的标题、说明与验证证据。未归档时归档 CI 失败是预期门禁，不绕过。

归档前同步集成分支、解决冲突并验证；归档推送后执行：

```bash
node .agents/skills/spec-trail/scripts/integration.mjs preflight --change example
```

预检只定向获取引用并检查，输出源 SHA、目标和合并消息。通过后将已有 Draft 转为可审阅；缺失时补建。未归档不得合入，已接入的归档 CI 须通过。按已有授权普通 merge，并传入预期源 SHA；合并消息末尾保留同一标记。源或目标推进后重新预检并核对 CI 与受影响验证。只允许 squash/rebase 或无法保留消息时报告受阻，不回退直推。

M 必须在集成分支 first-parent 链上，恰有两个父提交；标记唯一，首次只引入本 Change 的有效归档，归档子树与第二父提交一致。合入响应未知、排队或受理均先查平台与远端，不能据此宣称成功：

```bash
node .agents/skills/spec-trail/scripts/integration.mjs verify --change example
```

## 返修

归档尚未集成时，先核实 PR 未合入、取消已有自动合并并按需转为 Draft，再用 `change.mjs rework --stage execution --reason ... --approach ...` 恢复原 Change，追加返修任务。命令刷新集中入口及合入索引，移回文档并恢复原型路径；已完成任务保留，关闭记录清除。重新交付前复查远端与源 SHA。

已集成、路由冲突、无标记合入或历史不可读均不自动恢复；本地锁不能阻止远端并发合并。已集成后的修正建立新 Change。

## 清理

核实 M 后，在干净的主工作区安全快进集成分支，按项目约定更新服务并验证原型/产物。移出待删 worktree，确认其客户端会话、后台任务和服务不再写入，再执行：

```bash
node .agents/skills/spec-trail/scripts/integration.mjs cleanup --repo /path/to/primary --change example --verified-commit <M> --idle-worktree /path/to/source
```

`--verified-commit` 记录 Agent 已完成的交付/服务与托管产物验证，`--idle-worktree` 记录实际占用核对，不是新增用户审批。无 source worktree 时可省略后者。脚本复验远端 M、归属、依赖、源码/HTML 对象、待删 tip、Git 锁与文件状态；未知或不满足条件即保留。

任何未提交、未跟踪或忽略文件都会阻止工作区删除；assume-unchanged / skip-worktree 标记须先解除并检查文件。先按项目规则处理可重建依赖与构建产物；独有环境配置、用户资料和持久数据须保留，不能用强制删除绕过。主工作区、协作/发布分支及其他 active/cancelled 入口依赖不能删除。

顺序为远端源分支 → worktree → 本地源分支。远端按预期 tip 条件删除，本地使用已合并检查和非强制 worktree 删除。结果逐对象标为 cleaned/retained/failed；退出码 2 表示清理遗留，合入事实仍成立。相同命令可继续清理，不重复生成 M，已不存在对象视作完成。
