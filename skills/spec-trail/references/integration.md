# 归档集成与来源清理

归档前在所属 worktree 同步协作分支、解决冲突并验证；已提交归档不可修改。仅规划的 xlarge 父项先用 `workspace.mjs handoff` 建立独立关闭分支。下列命令使用 workflow v2 和 origin，共用仓库状态锁，不写回归档。

## 集成

```bash
node .agents/skills/spec-trail/scripts/integration.mjs preflight --change example
node .agents/skills/spec-trail/scripts/integration.mjs merge --change example
```

preflight 定向获取协作/来源引用并检查，不推送或删除。merge 推送固定的已归档来源 S，从最新远端协作提交 B 创建隔离候选 M，并以普通推送发布：

```text
Merge Change example into develop

SpecTrail-Change: example
```

M 必须位于协作 first-parent 链，恰有 B/S 两个父提交；标记唯一，首次只引入 example 的完整有效归档，归档子树与 S 一致。标题中的目标取实际配置。重复或非法标记、历史不可读均停止；不通过分支名或提交标题猜测。

推送响应未知先查远端。协作并发推进时从新 B 重建未发布候选，最多三次，不强推；已存在合法 M 时复用。冲突或远端核实失败保留候选路径与来源，核对现场后重试。已通过其他方式提前合入但没有合法 M 的交付不自动补造历史。

## 清理

核实 M 后，在干净的主工作区安全快进协作分支，按项目约定更新服务并验证原型/产物。移出待删 worktree，确认其客户端会话、后台任务和服务不再写入，再执行：

```bash
node .agents/skills/spec-trail/scripts/integration.mjs cleanup --repo /path/to/primary --change example --verified-commit <M> --idle-worktree /path/to/source
```

`--verified-commit` 记录 Agent 已完成的交付/服务与托管产物验证，`--idle-worktree` 记录实际占用核对，不是新增用户审批。无 source worktree 时可省略后者。脚本复验远端 M、归属、依赖、源码/HTML 对象、待删 tip、Git 锁与文件状态；未知或不满足条件即保留。

任何未提交、未跟踪或忽略文件都会阻止工作区删除；assume-unchanged / skip-worktree 标记须先解除并检查文件。先按项目规则处理可重建依赖与构建产物；独有环境配置、用户资料和持久数据须保留，不能用强制删除绕过。主工作区、协作/保护分支及其他 active/cancelled 入口依赖不能删除。

顺序为远端源分支 → worktree → 本地源分支。远端按预期 tip 条件删除，本地使用已合并检查和非强制 worktree 删除。结果逐对象标为 cleaned/retained/failed；退出码 2 表示清理遗留，合入事实仍成立。相同命令可继续清理，不重复生成 M，已不存在对象视作完成。

## 旧标签退出

新读取端生效、冷缓存与公开版本验证通过，并确认没有会话继续运行旧归档脚本后，列出精确清单：

```bash
node .agents/skills/spec-trail/scripts/retire-archive-tags.mjs list --manifest /tmp/archive-tags.json
node .agents/skills/spec-trail/scripts/retire-archive-tags.mjs delete --manifest /tmp/archive-tags.json --service-ready
```

list 只读，清单文件必须不存在。核对清单后按现有授权执行 delete；只删除 `refs/tags/spec-trail/archive-v2/*` 中列明且对象未变的引用。远端核实不存在后才按预期对象删除本地标签；并发变化或删除权限不足单独报告。重试可复用清单，新出现的标签另列清单核实，不扩大删除范围。

OpenFolio 缓存刷新持有写锁，删除 `refs/openfolio/archive-v2/*` 并在成功发布新快照后清理失效标签快照；未访问缓存随下次刷新重建。不回填关联，不保留双读；外部产物、既有公开版本、当前清单、登录和偏好不在清理范围，无需 Git GC。
