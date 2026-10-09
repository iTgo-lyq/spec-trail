---
name: spec-trail-prototype
description: SpecTrail 的原型子 skill。在用户同意后接入项目内单一原型包，复用设计规范，开发并导出自包含 HTML，将页面或组件关联到 Change，维护归档预览引用。由主 skill 技术阶段按需加载。
---

# SpecTrail Prototype

原型与 Change 一起管理。每项目一个 monorepo 包，默认 `packages/prototype/`；源码自由组织，页面和组件共用设计标准及依赖。工作台只读已推送静态产物，不编辑、不构建、不调度 Agent。工作台以 Change 关联提供项目原型总览。无模板服务、单独原型清单或截图要求。

## 接入选择

先读项目 AGENTS.md、现有设计标准、组件库、workspace 配置与 `docs/project/workflow.json.prototype`，并核对用户当前明确选择。配置基线是 OpenFolio 项目的 specBranch，未指定时为远端默认分支；切换旧分支不能抹去基线的拒绝决定。获取不到基线时说明缺失，不猜测已获同意。

- 缺失：技术方案确实受益于原型时，说明用途并征求同意。已有明确同意直接沿用。
- disabled：不重复提议，不新增非空 previews；只有用户明确要求重新启用才接入。普通 Change 推进和删除旧关联不受阻。
- pending：保留初始化失败现场，修复缺失后再启用。
- enabled：复用现有包，不再安装、创建第二个包或重复确认。

本子 skill 随主 skill 分发，未安装时补齐 `prototype/` 子目录，不创建独立顶层 skill。详细契约由 [contract.mjs](./scripts/contract.mjs) 与主 skill 的状态类型共同约束。

本地辅助脚本使用 Node.js 24 或更新版本，不安装第三方运行依赖。在仓库根运行（脚本路径均相对此 skill）：

```bash
node .agents/skills/spec-trail/prototype/scripts/setup.mjs --accept --summary '用户本次明确同意的依据' --package packages/prototype --design docs/design.md
node .agents/skills/spec-trail/prototype/scripts/setup.mjs --decline --summary '用户本次明确拒绝的依据'
```

`--design` 可省略；已有规范时提供实际路径并在 DESIGN.md 引用，不复制出第二份规范。没有规范时与项目上下文一起建立单一标准。setup 先写 pending，创建或检查包，成功才写 enabled。脚本不覆盖已有包或文档；已有工程需要调整构建时由用户 Agent 在包内完成，再运行 `--enable`。遇到包路径冲突、符号链接、workspace 冲突时保留现状，做具体修复，不另起一套包。

检查 npm/yarn/pnpm workspace 已实际包含此包，保留原包管理器与锁文件；脚本不会替用户安装框架。原型包 private:true，生产应用不依赖它。提交选择、包源码和输出，并将选择发布到服务配置基线；未发布前工作台不会启用追踪。

## 开发与交付

基础工程只提供静态 HTML、共享 CSS 和零依赖导出示例；用户可替换源码组织和构建工具。优先使用项目组件库、字体、颜色、间距和交互规范；后端耦合组件用局部 mock 适配并写明差异。不要把界面示意说成产品已实现。

运行服务采用同域 `sandbox="allow-scripts"` 和 CSP，未授予 allow-same-origin。交付约定：

- 每个关联目录是 `<包路径>/preview/<入口>/`，内含 UTF-8、自包含 `index.html`。
- 脚本、样式和 mock 数据内联，图片/字体用 data URL。不留外部 import、动态 chunk、资源 fetch、CSS @import、外链或 iframe。用 hash/memory 路由和页面内存状态；不能依赖 Cookie、localStorage、IndexedDB、Worker、eval 或真实业务接口。
- 一套源码导出多个 HTML，可复用源组件和素材。基础导出器识别 `src/pages/<id>.html` 中的 `{{include:相对路径}}` 和 `{{data:相对素材路径}}`；其他框架须自行配置离线导出，不假设普通 Vite dist 就满足协议。
- Git 跟踪源码、锁文件、设计引用及 preview 输出；排除依赖、缓存、日志和 sourcemap。不要在产物放密钥。单入口默认上限 10 MiB，具体服务限额可配置。
- 删除入口前检查其他活动 Change 的引用，不因构建一个入口就清空其他交付。

先运行包的构建，再执行校验：

```bash
node .agents/skills/spec-trail/prototype/scripts/validate.mjs
node .agents/skills/spec-trail/prototype/scripts/validate.mjs --browser
```

浏览器检查使用工程已安装的 `@playwright/test`；其他环境可用 `--playwright /实际模块入口` 指定已有安装。未安装时按项目惯例接入浏览器测试，不把“静态检查通过”冒充完整验证。检查关键交互及声明视口，确保没有依赖网络、存储或真实设备能力；脚本只检查初始加载，不能代替操作验证。

## 关联 Change

将关联数组写入临时 JSON 文件，调用主 skill 的 `change.mjs previews-set --change <id> --file <临时文件>`；脚本仅更新 `change.json.previews` 并保留其他状态字段，不生成 prototype.json。关联只在项目 enabled 后新增；id 为当前 Change 内唯一 kebab-case，标题非空，path 是包内 preview 入口目录。多个 Change 可以复用同一入口。

```json
[
  {"id":"orders","title":"订单列表","path":"packages/prototype/preview/orders","kind":"page","devices":["pc-web","ipad","mobile"]},
  {"id":"price-card","title":"价格卡片","path":"packages/prototype/preview/price-card","kind":"component","viewport":{"width":640,"height":320}}
]
```

page 使用非空、不重复 devices；component 在 devices 与 viewport 中二选一。宽高是 1–4096 的整数 CSS px。适配声明不是验证通过凭据，执行记录保存具体操作和结果。源码、关联与输出一起提交推送，hook 只认可暂存文件。OpenFolio 读取主来源提交，历史链接固定 revision；本地预览不代表已发布。

## 归档

主 skill 完成验证、用户验收与 Specs 同步后，提交完整归档记录及原型产物。携带非空关联的归档需要保留 Git 引用；不移动原型目录，不复制源码进 Change 文档。

```bash
node .agents/skills/spec-trail/prototype/scripts/archive.mjs --change 实际-change-id --push
```

脚本验证 completed 归档和已有入口，创建 `spec-trail/archive/<id>` 标签，推送当前分支和标签并核对远端。无关联无需标签。相同提交可重试，同名不同提交停止并报告，不覆盖标签；网络或推送失败保留现场并说明尚未完成交付。旧分支删除后标签继续保留源码及产物；标签被管理员删除时服务明确不可用，不回退最新版。停用时已有归档标签和文件保留。
