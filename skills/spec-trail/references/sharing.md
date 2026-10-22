# Change 分享链接

使用 `docs/project/workflow.json` 的 `openfolioUrl` 作为 OpenFolio 服务根地址，例如 `https://folio.example.org`。材料提交推送后直接提供分享链接，不请求工作台接口、不验证内容或可访问性、不等待同步；用户进入网页后由页面刷新获取内容。

提交推送目标材料后运行（Node.js 20+，无第三方依赖）：

```bash
node .agents/skills/spec-trail/scripts/share.mjs --change change-id --document technical.md
node .agents/skills/spec-trail/scripts/share.mjs --change change-id --preview preview-id
```

可用 `--repo /path/to/checkout` 指定仓库；省略材料参数分享概览。脚本只读取本地 origin 和 workflow 并返回 `url`，包含仓库、集成分支、Change 和材料定位参数。

主动贴出返回链接即可，无需分享账号、密码或 Token。未配置 `openfolioUrl` 时提供仓库材料链接。分享页跟随已推送内容，首次打开可能暂未同步，不承诺生成链接时已加载最新内容。
