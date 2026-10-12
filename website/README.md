# SpecTrail 产品介绍站

独立的中文静态介绍站，分为首页、Skill、OpenFolio 工作台和原型管理四页。内容以分发包和 OpenFolio 当前 README 为依据；不包含工作台服务、用户数据或发布密钥。首页交互均使用标明的示例内容。

## 构建与预览

需要 Node.js 24，无 npm 依赖：

```sh
node website/build.mjs
node website/serve.mjs
```

预览仅监听 `http://127.0.0.1:4175`。源码在 `website/`，产物为被忽略的 `dist/website/`。`node website/check.mjs` 检查页面、资源、本地链接与安装命令；`node website/verify.mjs` 使用已有 Playwright 验证浏览器交互，可用 `SPEC_TRAIL_PLAYWRIGHT` 指定 Playwright 包目录。截图与验证记录放 `.cache/website/`，不提交。

## 设计与内容

参考 Runweft 的静态站组织与视觉语言：雾蓝 `#f6f9fd`、白色 `#ffffff`、正文海军蓝 `#122b42`、操作钴蓝 `#2860e1`、辅助文字 `#627489`、细边框 `#dfe7f0`。标题使用 Avenir Next / URW Gothic 配合中文系统字体，正文使用系统无衬线，代码使用系统等宽。正文 16px，主内容最大 1180px，800px 以下改单列；交互保留键盘焦点、无 JS 阅读和 reduced-motion 支持。

标志是代码原生 SVG 的 Git 路径与节点；首页的示例工程记录可切换三个模块，用同一项“订单导出”说明各自职责。OpenFolio 图片为本项目已验证的真实首次连接界面，不含用户凭据；在线原型链接使用已发布的示例数据版本。

Skill 安装与工程推进；工作台连接个人 GitHub token 后只读已推送记录；原型管理为可选子模块，管理当前清单和 Change 固定版本。网站不把 Cloudflare 静态站表示为正在运行的 OpenFolio 服务。

## Cloudflare Pages

工作流 `.github/workflows/website-pages.yml`：main 网站相关推送发布生产；codex 分支发布预览；PR 只检查；支持手动运行。生产上传前核对当前 main，过时 run 拒绝上传。上传后的唯一地址逐文件验证摘要与 MIME，部署记录写入 Actions summary。

在本仓库 Repository secrets 配置 `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_API_TOKEN`（目标账户的 Cloudflare Pages Edit 权限）。可选 Repository variable `CLOUDFLARE_PAGES_PROJECT`，默认 `spec-trail`。项目明确不存在时创建 Direct Upload 项目，生产分支 main；已有 Git 接入项目或生产分支不同的项目拒绝自动修改。域名以 Cloudflare 返回值为准。

生产缺凭据明确失败；开发分支缺凭据完成静态检查并记录“未发布”。无需账户数据库、Node 生产服务、外部字体或脚本。构建只复制网站白名单，不上传 Skill 源码、工程存档或运行环境。

网页验证和 Skill 同步互相独立，现有 OpenFolio → SpecTrail 同步继续只更新 `skills/spec-trail/`。
