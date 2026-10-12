# T1：由 iclaude 重写全部站点文案并审阅上手路径

四个页面及共用导航、安装区、按钮、提示词、SEO、示例说明、复制反馈由 iclaude 组织。项目 Agent 应用复审中的 17 处修订，补足安装事实与必要的显示、复制交互修正；具体问题和截图见 [评审记录](review.md)。

## 实际验证

- `node website/build.mjs`、`node website/check.mjs`：四页、10 个公开文件、站内锚点、模板、复制目标、README 安装命令和产物摘要通过。
- `SPEC_TRAIL_PLAYWRIGHT=/home/tiger/workspace/open-folio/node_modules/playwright node website/verify.mjs`：20 个页面/宽度组合及既有交互、无 JS、键盘和 reduced-motion 路径通过。
- 聚焦首次使用的浏览器检查：手机首页到 Skill 安装、Claude Code 新命令与说明、三个提示词复制及对话反馈、折叠部署命令的键盘展开/复制/拒绝降级通过；结果保存在 evidence。
- skills@1.7.1 临时 Git 仓库安装：Codex 生成共享目录；原 Claude Code 单客户端模式只生成客户端目录；新 `universal claude-code` 模式同时生成两者，配置 workflow 后 setup 检查 ready。
- 公开原型：三个 R2 固定地址返回 200；`demo` 模拟连接关闭对话框并显示连接提示。曾使用“发现完成三仓库”作为断言，该原型未提供此自动完成状态，因此不将此作为通过证据；说明始终限定模拟设计。
- 提交校验：实际仓库维护的 hook 在临时仓库接受有效 workflow，拒绝空 protectedBranches 并传播非零退出码；本仓库只读 setup 检查 ready。setup 的 hook 字段按工具契约仍为 unverified，实际执行证据独立记录。

## 发布路径

内容提交 `35c325ebdc330c999599ad87ebc4d8449c05f97c` 经 [Actions 38251464907](https://github.com/iTgo-lyq/spec-trail/actions/runs/38251464907) 发布到 [唯一预览地址](https://941466e8.spec-trail.pages.dev/)。流水线的发布行为检查、构建、静态检查、上传与逐文件摘要/MIME 验证全部通过；项目 Agent 在真实浏览器中核对四页 200、手机无溢出、无页面错误、Claude Code 安装命令及 site.json 提交一致。

另用安装器从公开 `iTgo-lyq/spec-trail` 拉取分发包，在两个全新临时 Git 仓库执行 Codex 和纠正后的 Claude Code 安装参数，均成功并生成要求的入口，结果见 evidence/public-installation-check.json。

沿用已有 Cloudflare Pages 项目和发布工作流，在关闭和集成后继续核对生产内容。凭据使用既有 GitHub Repository secrets，未读取、保存或修改其值；最终集成与生产验证留在 Git/Actions，不回写只读归档。
