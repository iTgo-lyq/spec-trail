# 版本升级

1. 将 skill 目录整体更新到目标版本，保留项目配置。旧 workflow 升至 v3 时，将 collaborationBranch 改为 integrationBranch，选定独立的 releaseBranch 并移除 protectedBranches；按 [Setup](../setup/SKILL.md) 核对 hook 与归档 CI。
2. 核实历史 Change 确已合入发布分支后，可在集成分支 `docs/project/archive/.../change.json` 中补 `"deliveryOverride": "releaseMerged"`。这是归档只读的限定例外，仅增删此字段，普通提交留痕。工作分支和发布分支副本不生效；删除字段恢复自动判断。
3. 推送到集成分支后刷新工作台，核对“已发布”。有效归档中的补记优先于自动判断，缺少旧 PR 或合入记录不影响标签；它不生成交付证据，也不能代替 CI 检查。
