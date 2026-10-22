# Change 分享链接

在 `docs/project/workflow.json` 配置 `openfolioUrl` 为 OpenFolio 服务根地址，例如 `https://folio.example.org`。沿用现有字段，不需要分享账号、密码或 Token。平台入口须允许匿名访问；服务仍须存在可读取目标仓库的已接入来源。

提交推送目标材料后运行（Node.js 20+，无第三方依赖）：

```bash
node .agents/skills/spec-trail/scripts/share.mjs --change change-id --document technical.md
node .agents/skills/spec-trail/scripts/share.mjs --change change-id --preview preview-id
```

可用 `--repo /path/to/checkout` 指定仓库；省略材料参数分享概览。工具从 origin 和 workflow 生成稳定地址，匿名检查最新来源和正文/原型，返回 `url`、来源分支与提交。文档与当前提交的 Git blob 比对，原型与已提交 artifact 比对，Git 原型还核对实际 HTML blob；有未提交材料时拒绝。默认最多等待 70 秒让服务同步，可用 `--wait-seconds 0` 立即检查。

成功后主动贴出返回链接，说明已可查看对应材料。未配置地址、登录重定向、权限不可读、网络超时或材料未同步时如实说明，保留仓库文档或固定原型链接作为入口；不把构造成功冒充可访问，不要求用户配置分享账号。分享页随推送内容更新，返回的 commit 仅表示本次验证来源。
