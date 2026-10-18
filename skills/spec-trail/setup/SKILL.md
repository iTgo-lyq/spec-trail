---
name: spec-trail-setup
description: 首次或更新接入 SpecTrail 时，配置协作/预发布分支和保护分支，准备主工作区，检查环境并接通提交校验。常规 Change 推进使用主 SpecTrail skill。
---

# 接入 SpecTrail

SpecTrail 提供校验脚本、调用命令和只读 setup 检查。用户或业务项目的 Agent 根据项目现有流程完成 hook 接入，SpecTrail 不规定 hook 目录或管理工具。

校验使用 Node.js 20+、Git 和 Node.js 内置模块，无需第三方依赖。分支配置、skill 中的校验脚本及业务方维护的接入文件随仓库交付；本机 Git 配置不提交。只在 `.git/hooks` 写本机入口不算完成可共享接入。

## 先配置分支与工作区

创建 Change 前完成以下接入，沿用用户已有明确选择，不重复询问：

1. 核对仓库、remote、托管默认分支和实际权限/保护规则。协作分支名称优先沿用项目选择，推荐 `develop`，承担集中讨论与持续交付，接收已完成 Change；保护分支（例如 main）作为正式上线基线，仅在用户主动要求时普通 merge 或创建 PR，保留提交历史与规划文档。两种工作流角色分开登记，不能自动撤销平台保护。
2. 在 `docs/project/workflow.json` 保存 `schemaVersion: 2`、`collaborationBranch` 和非空 `protectedBranches`，保留原型及服务配置。已有同名协作分支先检查用途与内容；缺失时在接入授权内从核对过的基线准备，不覆盖分支。新仓库先提交接入文件才能建立分支引用。
3. 主工作区使用 workflow.json 配置的协作分支（develop 只是推荐名），用于规划和发现，不随任务切分支；执行在独立工作分支/worktree。默认路径为主工作区同级的 `<项目名>-worktrees/<工作区名>`，项目名取主工作区目录名，Change 默认用 id。已有工作区优先复用，显式路径按用户约定；切换前检查脏文件、已有 worktree 和会话，不搬动未提交现场。构建与长期服务沿用项目约定，主工作区可以继续承担这些用途，不因接入而迁走服务或另建服务 checkout。
4. 将配置与校验器提交到所选协作分支。OpenFolio 自动发现初次尝试推荐名称 develop；自定义名称通过「用仓库地址检查」填写并保存，须与该分支 workflow.json.collaborationBranch 一致。后续发现沿用保存的选择，阅读链接和最近仓库偏好保留实际分支。本地 CLI 使用当前工作树配置。后台不读取默认分支配置、不检查保护分支是否存在；无需为接入发布到保护分支。缺少有效协作配置时提示 Setup，不回退到其他分支或全量扫描。
5. 旧项目从已知 Change、已有 worktree 和明确提供的分支登记入口，保留工作分支和完整 JSON；不引入新的引用文件或历史状态镜像，不为迁移扫描全部分支。报告覆盖依据和未解决项，不声称已自动发现所有未知工作。

示例（名称以用户已有配置为准）：

```json
{ "schemaVersion": 2, "collaborationBranch": "develop", "protectedBranches": ["main"] }
```

## 准备检查

1. 核对上述配置与分支准备。没有 remote 时说明登记的是本地约定，尚无共享入口或服务端保护。
   校验器位于 `.agents/skills/spec-trail/setup/scripts/pre-commit.js`，依赖同一 skill 内的 `scripts/state-schema.mjs`、`scripts/routing.mjs` 与 `prototype/scripts/contract.mjs`；缺少文件时补齐 skill 交付，不复制校验逻辑到业务 hook。
2. 从任意目录运行，`<setup-dir>` 指本文件所在目录：

   ```bash
   node <setup-dir>/scripts/check-setup.mjs <repo-dir>
   ```

   检查器只读取目标仓库，不创建或复制文件、不修改 Git 配置、不执行业务 hook。JSON 输出 `readiness`、资源/配置问题、协作分支的已知引用、默认合入目标、调用命令和 Git 入口信息；退出码 0 表示本地准备就绪，1 表示需修正。已知本地或远程跟踪引用不证明远端仍存在；Agent 另用精确 ref 查询核实远端与平台权限。`remotePermissions` 和 `hook.status` 为 `unverified`，检查成功不代表权限与 hook 已验证。

## 已配置项目的入口检查

先完成 workflow v2 配置；旧版配置不会被校验器或流程命令接受。只读预览使用当前仓库配置、指定基线（省略时为协作分支）、Git worktree 登记与明确给出的工作分支：

```bash
node <setup-dir>/scripts/preview-routing.mjs --repo <repo-dir> --work-branch change/example
```

work-branch 可重复提供。脚本不联网、不扫描全部分支、不改 Git 引用/暂存区/工作文件；输出覆盖依据、每个来源提交与新鲜度、接入建议和冲突。先定向 fetch 所需引用，再复跑；本地与 tracking ref 不同、同 ID 多个主张、归档/活动冲突、缺失目标均需核对。未被列出的远端工作不会被自动发现，不把只读预览称为迁移完成。

普通 Change 已在基线进入实现或关闭时，先确认并准备独立工作分支；不能把执行状态留在集中规划分支。仅在工作分支出现的完成归档须连同交付集成后再作为集中历史，不能只复制归档就声称交付已集成。

在已配置当前协议的隔离候选中核对 skill/校验器。从预览的固定提交与目录引入已知 Change 的原始记录，保留工作分支；不要为入口生成另一套状态，也不要复制执行进度。新规划按主 skill 的 create 命令建立。现有活动分支合码时先核对 live/archive 是否并存及登记提交祖先关系，不机械删除其他活动记录。执行本机 Setup、实际 hook 与目标读取验证后，将候选发布到协作分支；主工作区只在干净且分支用途已核对时切换。保护分支仅按用户主动要求发布，不作为接入前置。

## 可选绘图 skill

首次或更新接入时，从当前 Agent 的 skill 列表或全局 skill 目录核对已有安装，并沿用当前会话中的明确选择。尚未安装且尚未明确选择时，询问用户是否全局安装 `document-diagrams`，用于后续需求和技术方案中的文档绘图：

> 是否安装 document-diagrams 绘图 skill？它会安装到全局 skill 目录，方便后续需求和技术方案绘图；不安装也可以继续接入 SpecTrail。

询问时一并展示以下完整命令，用户明确同意后执行：

```bash
npx --yes skills add iTgo-lyq/document-diagrams --skill document-diagrams --global
```

`--yes` 只用于命令执行，不替代用户的安装授权。已安装时不重复安装或升级；当前会话已有明确答复时沿用，不重复询问。用户拒绝、暂未答复或安装失败时，继续基础接入，实际需要绘图时再处理；失败如实报告。本步骤由 Agent 交互执行，不加入只读 setup 检查器，也不新增项目配置字段。

## 业务方接入与验证

由用户或业务 Agent 读取已有 hook 和项目配置，沿实际调用链找到项目维护的入口，保留既有检查和管理方式。Git 的实际入口可能只是生成的转发文件，例如 Husky 的 `.husky/_/pre-commit`；接入应写入项目维护的文件，不修改管理器生成文件。没有现成入口时，由业务方按项目约定选择持久化和本机启用方式，不由检查器设置 `core.hooksPath`。

在会修改暂存区的步骤之后、提前退出之前调用校验器；已有等效调用不重复添加。Shell 入口可使用：

```sh
node "$(git rev-parse --show-toplevel)/.agents/skills/spec-trail/setup/scripts/pre-commit.js" || exit $?
```

其他入口采用等效调用并传播非零退出码。接入只需调用校验器，无需为 SpecTrail 新增 npm 脚本或修改包配置；项目已有管理工具的安装配置继续由业务方维护。

手动运行校验器，并用不污染用户工作区或暂存区的方式验证实际提交入口的成功路径和失败传播；必要时使用临时测试仓库。只有实际执行证据才能确认 hook 已接通，目录存在、字符串匹配或 setup 检查成功均不算验收。没有待校验文件时如实报告，不能据此推定失败路径通过。

Git clone 传递接入文件和校验脚本，不传递本机 Git 配置；新克隆沿业务项目既有启用方式接入。同仓库 worktree 默认共用 Git 配置，入口应调用当前工作区的校验脚本。更换管理方式后重新核对实际入口与执行效果。

将接入文件和配置提交，并按已有授权与 remote 配置推送。报告持久化位置、业务启用方式、准备检查、实际 hook 验证及提交推送状态；未验证时明确说明。项目 README 只保留项目目标，SpecTrail 的接入规则维护在本 skill。

## 校验范围

- 只检查暂存区中本次新增、修改的 `docs/project/workflow.json`、`docs/project/changes/<id>/change.json` 和 `docs/project/archive/<date>-<id>/change.json`。重命名按目标文件检查，删除和未改动的历史文件不检查。
- 共享主 skill 的 `scripts/state-schema.mjs`，按主 skill 的 TypeScript 声明检查必需字段、类型、枚举、非空文本、带时区的有效时间、任务编号、未知字段及数组重复项，包含 `dependsOn`。
- 只保留明确的字段关联：`blocked` 任务需要 `reason`，`cancelled` Change 需要 `cancellation`。
- workflow 只接受 schemaVersion 2，必须配置有效协作分支，不能与保护分支角色重合。旧版配置由命令、hook 与 Setup 明确拒绝，先补齐当前配置；不保留旧版执行或升级读取路径。Change 记录的 schemaVersion 仍为 1，与 workflow 版本独立。
- 原型跨文件检查仅针对当前分支所属 live Change；继承副本仍检查本次暂存的完整 JSON 结构，其远端原型不要求在本地存在。hook 不 fetch、不跟随远端入口。
- 读取 Git 本次实际提交的暂存区版本，保留 `GIT_INDEX_FILE`。失败输出文件、字段和原因并阻止提交；不修改文件或暂存区。
- 确认是否有效、依赖是否满足、任务是否真正完成以及合码条件由 Agent 按主工作流判断。hook 不解析 Markdown，也不增加开发、归档或合码门禁。

更新规则时只修改 skill 中的校验脚本并提交对应更新，使规则与主 skill 的类型声明保持一致；hook 保持对该脚本的调用。

修改校验规则或 setup 检查后运行 `node --test <setup-dir>/tests/setup.test.mjs`，覆盖只读检查、业务方显式接入、字段规则、暂存区、部分提交、clone 和 worktree。
