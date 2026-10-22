# 发布 PR

仅在用户明确要求正式版本时执行。读取 integrationBranch / releaseBranch 和项目版本约定，固定发布目标基线与候选提交，核对实际 diff、已集成 Change、关联 PR 和验证记录。默认以集成分支提交 PR；需要冻结候选时才建短期发布准备分支。

版本或范围尚未明确时，按项目约定提出有依据的候选。创建或更新同一发布 PR，正文集中说明：

- 版本号及本次发布范围。
- 面向使用者的功能、修复和必要升级影响，省略空分类。
- 实际包含的 Change / PR，以及验证结果与已知限制。

提交标题仅作线索，不代替内容整理。候选改变时更新说明和验证；实质修复先经 Change 集成。正文末尾独立段落保留：

```text
SpecTrail-Version: 1.2.0
SpecTrail-Includes: change-a
SpecTrail-Includes: change-b
```

版本沿用项目约定；清单仅列本次实际包含的 Change，撤回的内容移出并说明。不额外维护 CHANGELOG.md、tag、GitHub Release 或清单副本。

准备 PR 不等于授权合并。清单内 Change 须已归档并完成集成，已接入的归档 CI 须通过；其他规划可保留。沿用会话授权，以普通 merge 保留历史与规划文档；核对预期源 SHA。候选推进后重查范围与 CI，合并失败或结果未知先核实，不回退直推。确认实际合并提交已在 releaseBranch 后报告合入；PR、服务部署分别说明，不把规划文档或 PR 合入当作功能上线。
