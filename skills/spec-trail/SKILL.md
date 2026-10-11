---
name: spec-trail
description: 管理单个 Git 仓库 docs/project 下的需求、技术方案、计划、执行、验收和归档。用于推进或返工 Change、协调 Change 依赖、取消工作、同步 Specs，以及同仓库分支或 worktree 合码；以 change.json 维护流程状态。
---

# SpecTrail

## 入口与通用约束

一个项目使用一个 Git 仓库，工程文档统一放在根目录 `docs/project/`；多应用、服务或共享包建议采用 monorepo，同仓库 worktree 共用本约定。

用户派发任务时，先检查分支、工作区和相关 Change：

- **无需创建 Change**：纯问答、讨论、只读调查或评审；局部、无歧义的拼写、注释、格式等机械修正，或纠正、补录既有事实的文档描述。后两类必须不改变产品行为、既定要求、架构、共享契约、数据迁移、权限安全或难回退的外部状态。
- **讨论中先行交付**：讨论现有 Change 时，用户提出先实现相关内容、其余方案继续讨论，主动询问是否拆为独立 Change，并简述范围与依赖；已有明确拆分授权时不重复询问。确认后按[创建与规模](#创建与规模)建立新 Change，调整原 Change 范围；仅有实际交付依赖时按[依赖规则](#change-之间的依赖)登记 `dependsOn`，不因执行先后而声明依赖。
- **复用已有 Change**：目标被现有 `active` Change 覆盖时询问用户是否复用。
- **需要新建**：按[创建与规模](#创建与规模)完成简短确认，再建立 Change。

当前阶段仅从本地仓库已有分支和 worktree 中 `docs/project/` 下的 `changes/` 与 `archive/` 查找 Change，按 id 识别，以 `branch` 指定分支的本地记录为准；后续接入 open-folio 服务提供的 CLI 查询。

### 分支与协作

- 每个 Change 只有一个主分支，由 `change.json.branch` 指定，默认 `change/<id>`。同一分支同时只开发一个 Change（execution / close），规划中的可以有多个；依赖尚未合入的 Change 时可在对方分支规划，满足[Change 依赖](#change-之间的依赖)后再开发。
- `change.json` 只在 Change 分支更新；可选任务分支使用 `task/<id>/T<n>`，只提交实现和证据。
- 守护分支不直接开发。开始开发前 `git fetch` 并同步落后的分支。当前分支存在已取消 Change 时停止开发，冻结范围与仅规划取消的例外见[取消](#取消-change)。
- 调查和规划可并行；实现边界独立时可使用分支或 worktree。共享行为、Spec、契约、迁移或核心文件重叠时串行协调，small 也不例外。

首次接入按 [Setup 子 skill](./setup/SKILL.md) 核实实际默认分支和保护规则、登记 `WorkflowConfig` 并检查校验环境，由业务项目的用户或 Agent 接入提交校验并验证；完成后再开始产品开发。

## 文档与事实来源

`change.json` 是流程状态的唯一来源，Markdown 保存正文与证据，Git 保存历史。工作台和协作者以推送到中心仓库的 Change 文档为准；本地工作区、暂存区及未推送提交不算已持久化的流程事实，提交标题和历史只供查找参考。

| 位置（相对 `docs/project/`） | 职责 |
| --- | --- |
| `workflow.json` | 实际守护分支配置 |
| `specs/<capability-path>/spec.md` | 当前已实现、验证且仍有效的产品能力与核心技术方案；内容范围见[Specs 同步](#关闭与-specs) |
| `changes/<id>/` | 尚未归档的 Change，含正文、状态和证据；取消的 Change 也保留在这里 |
| `archive/YYYY-MM-DD-<id>/` | 已完成关闭的完整 Change，作为只读历史保存 |

一个 Change 对应一个内聚目标。正文按阶段创建，省略空章节，不生成占位文件、额外索引、TODO、重复状态表或版本计数器，不按固定篇幅或评分凑内容；需求、技术和计划均不写逐文件操作说明。

| Change 内文件 | 内容 |
| --- | --- |
| `requirement.md` | 目标、范围、行为变化、验收；small 另含方案要点 |
| `technical.md` | medium 及以上：实现方案、契约、关键取舍、验证路径 |
| `plan.md` | medium / large：任务定义、执行顺序、验收和验证；xlarge：子 Change 拆分 |
| `research.md` | 按需保存跨会话引用的调查证据与实验结论 |
| `execution.md` | 按任务编号记录实际范围、验证命令与结果、未解决事项；large 必需，其余按需 |
| `review.md` | 评审问题的独立编号、证据、影响与复验结论；large 必需，其余按需 |
| `merge-technical.md` | 实质合码冲突的差异、决策、顺序与验证方法，按需创建 |

Markdown 不维护阶段、完成勾选、任务或审批状态，也不能用正文证据替代 JSON 状态。JSON 只使用已声明字段，文本不填空字符串，尚未发生的可选记录省略。

## 状态操作入口

常规 `change.json` 创建和修改统一使用主 skill 自带的 [语义命令](./references/state-commands.md)：`node .agents/skills/spec-trail/scripts/change.mjs <command> --change <id>`。调用前按需读取命令说明；不要手写 JSON、用通用 patch 或临时 Python/JS 拼接状态。正文 Markdown 继续直接编辑，下面的字段定义用于阅读与校验。

脚本负责 UTC 毫秒时间、操作前置、失效状态清理和原子写入；Agent 负责实际确认、验证证据、正文一致性与提交推送。用户明确授权的历史勘误可在所属分支做最小人工修正并说明原因。共享校验在 `scripts/state-schema.mjs`，hook 与语义命令共用，保持零第三方依赖。

## 读取 Change 现状

读取 `change.json`，核对 `branch` 及当前工作区与已推送版本的差异，依次检查：

1. `status`：仅推进 active；completed 为已关闭的归档历史，cancelled 按取消规则处理。
2. `stage`、`size`、`confirmations`、`rework`：读取相关正文，按[阶段推进](#阶段推进)核对有效确认。
3. `dependsOn`：读取前置 Change 已推送的 JSON，检查[依赖条件](#change-之间的依赖)，不复制其状态。
4. `waitingFor`、任务状态和阻塞原因：small 从 JSON 读任务，medium / large 结合 Plan，xlarge 读取子 Change 状态。
5. `closure`：核对关闭各步的记录与证据。

### 状态字段

```ts
type ISODateTime = string; // 新记录由脚本写 UTC 三位毫秒 ISO 时间；读取兼容原有带时区格式

interface WorkflowConfig {
  schemaVersion: 1;
  protectedBranches: string[]; // 非空、去重；实际本地分支名，不带远程前缀或通配符
  openfolioUrl?: string | null; // 缺失为未询问，null 为无自建服务
  prototype?: PrototypeConfig; // 可选原型接入；缺失表示未选择
}

interface PrototypeConfig {
  status: "disabled" | "pending" | "enabled";
  packagePath?: string; // pending/enabled 必填，disabled 省略；每项目一个包
  hosting?: { provider: "openfolio" | "custom" | "git"; uploadUrl?: string };
}
interface PreviewEntry {
  id: string;
  title: string;
  artifact: { type: "git"; path: string; sourceCommit: string } | {
    type: "hosted"; version: string; url: string; sourceCommit: string; digest: string;
    thumbnails?: { device?: "pc-web" | "ipad" | "mobile"; url: string }[];
  }; // 固定产物引用，详细契约见原型子 skill
  kind: "page" | "component";
  devices?: ("pc-web" | "ipad" | "mobile")[]; // page 必填；去重、非空
  viewport?: { width: number; height: number }; // component 与 devices 二选一，1–4096 CSS px
}

interface Confirmation {
  at: ISODateTime;
  summary: string;
  source?: string;
}

interface ClosureStep<Result extends string> {
  result: Result;
  at: ISODateTime;
  summary: string;
}

interface ChangeTask {
  title: string;
  status: "todo" | "doing" | "done" | "blocked";
  branch?: string; // 使用任务分支时填写
  reason?: string; // blocked 时必填，说明解除条件
  verification?: string;
  commitTitle?: string; // 可选查找线索，不作为流程事实
}

interface ChangeState {
  schemaVersion: 1;
  id: string; // 仓库内唯一的小写 kebab-case，与目录名一致
  title: string;
  size: "small" | "medium" | "large" | "xlarge";
  status: "active" | "completed" | "cancelled";
  stage: "requirement" | "technical" | "plan" | "execution" | "close";
  branch: string; // 实际 Change 分支，默认 change/<id>
  previews?: PreviewEntry[]; // 可省略；记录本次固定交付；项目当前清单位于原型包 prototype.json
  dependsOn?: string[]; // 前置 Change id，去重；全部满足后执行，xlarge 父 Change 不填
  parent?: string; // 所属 xlarge 父 Change 的 id
  children?: string[]; // 子 Change id，按 Plan 展示顺序排列且不重复；不表示串行依赖
  confirmations: {
    requirement?: Confirmation;
    technical?: Confirmation;
    plan?: Confirmation;
    merge?: Confirmation & {
      sourceCommit?: string; // 提交 hash：7–64 位小写十六进制
      targetCommit?: string;
      baseCommit?: string;
    };
  };
  tasks: Record<`T${number}`, ChangeTask>; // T1、T2……，编号为正整数
  waitingFor?: {
    kind: "confirmation" | "dependency" | "pause";
    summary: string;
  };
  rework?: { at: ISODateTime; reason: string; approach: string };
  closure: {
    verification?: ClosureStep<"passed" | "failed">;
    acceptance?: ClosureStep<"accepted"> & { source?: string }; // small 可由 Agent 自验收；摘要注明方式与依据
    specs?: ClosureStep<"synced" | "not_needed">;
    archive?: ClosureStep<"done"> & { path: string }; // docs/project/archive/YYYY-MM-DD-<id>
  };
  cancellation?: { at: ISODateTime; reason: string }; // cancelled 时必填
}
```

## 创建与规模

### 创建前确认

读取当前对话和必要事实，按核心契约变化、预期实现范围及[任务粒度](#计划与任务)判断规模。局部修改通常为 small；只有实质改变核心契约，或预期实现规模较大时，才升级为 medium 及以上：

| 规模 | 判断（默认参考线） | 必需正文 |
| --- | --- | --- |
| small | 核心契约不变，预计不足 300 行有效实现代码，少于 3 个需联动修改的职责模块；通常一个局部任务 | Requirement，含方案要点 |
| medium | 实质改变核心契约；或预计达到 300 行有效实现代码；或至少 3 个职责模块需联动新增、重写逻辑 | Requirement、Technical、Plan |
| large | 预计达到 1000 行有效实现代码，或至少 5 项需要分阶段集成的独立交付任务 | 上述文档及 Execution、Review |
| xlarge | 需拆为可独立推进、验收和合入的子 Change | Requirement、Technical、Plan，按子 Change 规划 |

判断依据：

- **核心契约**：多个模块或外部调用方共同依赖的稳定接口、持久化数据结构或协议，其关键字段或语义变化需要协同适配、兼容设计或迁移。普通局部配置项和内部参数不自动属于核心契约。
- **有效实现代码**：估算新增或实质改写后的手写生产代码行数，替换同一段代码只计一次；不计空行、注释、配套测试、文档、生成代码，以及纯删除、格式化、搬移、批量替换等机械改动。
- **职责模块与交付任务**：模块按 API、存储、UI 等独立职责计数，不按文件或目录计数；只有需要新增、重写逻辑的模块才计入，同步调用、类型引用不单独计入。任务按[任务粒度](#计划与任务)划分，不把编码、测试、文档等步骤拆成多项凑数。
- 权限、安全、配置等主题，以及一次用户澄清或取舍，不单独构成升级理由；验证与实际操作授权仍按具体影响处理。

默认按满足的最高档位估算。上述数字是事前参考线，不要求逐行审计；临界情况结合职责边界与验证范围判断，偏离默认档位时说明具体依据。xlarge 由是否需要独立子 Change 决定，不仅凭行数升级。

信息不足时先做针对性调查或澄清，按已知影响给出暂定规模，并随证据调整。并行不是 large 的必要条件。简述目标、暂定 `size`、具体判断依据和大致方案，请用户确认启动方向；意图模糊时只追问影响方向的问题。父 Change 已确认的拆分可作为子 Change 的启动确认。

此时无需建立文档或完成全部设计。创建前确认不替代后续阶段确认，不新增 JSON 确认字段。

### 初始化

用户认可后：

1. 按字段约定生成 `id`，核对本地 Change、分支与归档，避免重名。id 表达用户结果，不用纯日期或模糊名称，创建后不变；`title` 可调整。
2. 从最新守护分支创建 `change/<id>`；在依赖分支规划时，`branch` 填实际分支。
3. 在实际 Change 分支运行 `create` 建立目录与初始 JSON，传目标、规模与已有依赖/父子关系；脚本生成 `active` / `requirement` 和空流程记录。
4. 将已有目标、范围、方向、未决问题及外部材料写入 `requirement.md`，继续需求整理。

### Change 之间的依赖

small / medium / large 用 `dependsOn` 声明同仓库的前置 Change，在 Requirement 说明用途，与 `parent / children` 独立。声明时目标必须已建立并推送；依赖不得重复、自指或成环，也不得与父等待子完成的关系构成循环，子 Change 不得依赖其父 Change。

进入 execution 并开始实现前，所有前置 Change 都须满足：**已完成关闭、归档并推送，且所需交付已在当前分支可用**。独立分支默认等上游合入守护分支后再同步；同分支规划的 Change 在上游关闭且交付已在本分支时即可继续，不额外要求先合入守护分支。

依赖未满足时可继续调查、澄清和规划；准备执行时仍未满足，保留当前阶段和有效确认，设置 dependency 等待，说明缺少的交付和解除条件。依赖取消、缺失或状态异常均不算满足。解除等待后保留 `dependsOn`；调整依赖时同步用途说明，涉及目标或关键方案变化时按返工规则处理。

### xlarge 父子 Change

父 Change 只维护整体目标、架构、共享契约与拆分，分支只放文档。Plan 列每个子 Change 的 id、目标、边界、依赖、执行顺序和预估规模；JSON 用 `children` 关联，不设实现任务。实际前置依赖由相关子 Change 在 `dependsOn` 声明，父 Plan 汇总，不在父 JSON 声明或向子 Change 自动继承。

子 Change 从最新守护分支各建分支，用 `parent` 关联并引用父文档，按 small / medium / large 独立推进、验收、归档和合入，不再向下拆分。子状态只写入自身 JSON；调整拆分时同步父 Plan 和 `children`，改变整体目标或架构时回到父 Change 的相应阶段返工。全部子 Change 完成或取消后，父分支同步守护分支，验证整体目标及集成，再关闭。

### 规模调整

规模随证据按上述标准校准；变化时在会话中说明具体契约变化或实现范围，更新 `size`、补齐文档并对齐阶段。small 升级为 medium 时，可一次补齐需求、技术与计划确认后继续受影响实施。规模降低不撤销仍有效的确认，已完成任务保留。

执行中才发现需要拆为子 Change 时，收窄当前范围作为其中一个子 Change，另建父 Change 规划其余部分，按新范围重新核对确认与验证。

## 阶段推进

核对当前规模所需的上游确认仍适用于正文；缺少有效确认时停在最早需处理的阶段，旧 Technical / Plan 保留供修订。

进入 execution 前先按[Change 依赖](#change-之间的依赖)检查。确认要求和 JSON 更新如下：

| 当前阶段 | 完成条件与后续更新 |
| --- | --- |
| requirement，small | 创建前确认的方向未变，需求、方案要点、验收及任务已写入并推送；直接进入 execution，不记录需求、技术、计划确认 |
| requirement，其余规模 | 用户确认完整目标、范围和验收；记录 `confirmations.requirement`，进入 technical |
| technical，medium / xlarge | Technical 与 Plan 一起确认，xlarge 的 Plan 为子 Change 拆分；同时记录 `technical`、`plan` 确认，进入 execution，不单独进入 plan |
| technical，large | 用户确认方案与必要契约；记录 `confirmations.technical`，进入 plan |
| plan，large | 用户确认整体计划；记录 `confirmations.plan`，进入 execution，无需逐任务审批 |
| execution | 所有任务验证、提交并推送；xlarge 为所有子 Change 完成或取消；进入 close |
| close | 按规模完成[关闭四步](#关闭与-specs)：small 默认自验收后直接归档，其余等待人工验收；归档后才将 status 设为 completed |

## 需求与调查

读取对话、指定材料、相关 Specs 与活跃 Changes，从目标附近的项目规则、代码、配置、依赖和测试调查现状，按需扩大范围。

Requirement 按“背景与目标、范围、行为变化、验收标准”组织，只写容易误解的边界及实际约束；small 另加方案要点。行为按能力完整路径组织：`ADDED` 写新增行为，`MODIFIED` 写当前与目标，`REMOVED` 写删除及替代或迁移影响，无可观察变化时写“无”。按用户能力或完整流程组织内容，不按技术层拆分、不放任务清单或大量调查过程。验收标准应可通过测试、演示或观察判断，不重复目标行为、不指定实现文件、不凭空发明指标。

产品问题只追问会改变目标、范围、行为或验收的取舍。技术未知项只有在无法通过仓库、一手资料、只读外部状态或必要实验查明，无法可靠推理且实现或验证必需时，才说明缺失内容、影响和建议，向责任人澄清。其他事实继续调查，推断注明依据，未决项说明影响。安装依赖、持久写入、外部操作及高成本实验按已有授权执行；超出范围或有实质副作用时说明目的与影响，已有授权不足时再取得授权。

会话中说明目标、待确认内容、关键假设和限制，吸收反馈后修订正文。small 简述需求、方案与验收后按阶段表执行；其余规模先确认完整需求。

### 调查与协作资源

复用已有证据，发现可调查缺口就继续 Research，不因属于技术内容而推迟。结论注明“已确认 / 有条件可行 / 尚未验证 / 当前受阻”；较长证据放 Research，Requirement 只保留影响目标、范围、行为或验收的结论。

会话外资源首次使用时，在 Requirement 的“协作资源”登记标题、链接、读取日期与结论摘要。区分材料陈述、AI 推断和项目决策，与 Specs、实现或已确认需求冲突时显式提出。

当前 Change 产生的外部文档登记链接、用途、目标读者和同步状态；同用途资源优先复用，仓库文档仍为内容来源。外部文档的创建、更新、分享、权限调整和通知均按已有授权执行，不由“同步文档”推导额外授权。

### 最小正文

按上述结构编写，按需补充“约束与依赖”“可行性与限制”（结论、前提、带日期的依据、后续验证）和“未决问题”。medium 及以上可加 Review 导读，概括目标、待确认、假设与限制。

## 技术方案

涉及产品 UI 的 Change，先读 `workflow.json.prototype` 与现有用户选择：缺失时可提议并征求同意；disabled 不重复提议或启用追踪；pending 先完成接入；enabled 复用项目唯一原型包。已有明确同意直接沿用。同意接入后按 [Prototype 子 skill](./prototype/SKILL.md) 初始化，拒绝接入则记录 disabled。已启用时按子 skill 的 UI 规模规则决定询问或先绘制原型；构建、托管、当前清单与固定引用沿用其约定。

medium 及以上基于已确认需求、项目规则和 Research 编写 Technical；small 的方案留在 Requirement。技术澄清与规划阶段只修改文档，不提前修改正式交付代码。

技术未知项遵循[需求与调查](#需求与调查)的提问边界；不影响架构、安全、契约或可行性的任务内局部细节可留待执行。凭证只记录引用、交付与注入方式、环境与权限范围、负责人、就绪及轮换约定，不索要或写入秘密值；原型专用上传地址按子 skill 约定保存到 workflow。

### 技术就绪条件

Technical 保留方案、关键取舍、依据和验证路径，不写成任务清单。覆盖本次 Change 相关的以下内容后，才能请求方案确认：

- 每项目标行为的端到端实现路径、数据流及副作用明确，复用适用的现有架构与模式。
- 影响方案选择、核心可行性或验收的事实有足够证据，重要依赖的版本与能力已核对；区分“已验证 / 文档确认 / 合理推断 / 未确认”，不把平台能力存在写成项目已接通。
- 环境与部署差异、配置来源、数据与外部系统契约、兼容迁移、安全边界、失败降级及回退明确，涵盖不可逆外部状态。
- 外部前置条件的接口、负责人、状态、完成信号、阻塞影响与失败处理明确，不隐藏方案选择，且用户接受其作为 Plan 依赖时，才不阻塞技术确认。
- 验证覆盖验收标准，数据、环境、自动检查与人工验收路径可用或有安排；不存在影响架构、安全、契约或核心可行性的未确认假设或未澄清契约。

未满足时留在 technical 补充调查或必要输入，不进入新 Plan 的确认或执行。补充证据不机械退回需求；目标行为变化才回到 Requirement。large 在技术确认后创建新 Plan，medium / xlarge 将 Technical 与 Plan 一起准备；旧 Plan 可保留供修订。

### 最小正文

引用 Requirement，按“方案、影响、验证”组织，随复杂度展开；xlarge 增加拆分依据。Review 导读概括推荐方案、待确认和就绪性，按需列外部前置条件及未决问题。

## 计划与任务

本节任务粒度适用于所有规模；small 直接在 JSON 列任务，medium / large 使用 Plan，xlarge 的拆分见[父子 Change 约定](#xlarge-父子-change)。

Plan 引用 Requirement 与 Technical，说明交付目标、任务与整体验证；只有需要覆盖默认串行安排时才写执行顺序表。任务按编号列标题、交付、验收和验证方法，与 JSON 的编号、标题一致，初始状态为 `todo`。

### 任务粒度

一个任务对应一个可独立验证的用户场景或明确技术结果，连同必要实现、测试和文档，能在一轮聚焦实现、验证、提交中交付，差异能一次聚焦审阅。不按固定时长、文件数或代码行数设限。

- 包含多个可分别交付的结果、多个独立验证边界或需分批审阅时，继续拆分并列明依赖。
- 只是文件修改、字段或测试步骤，无法单独验证交付结果时，合回对应任务；同一场景必需的异常处理和测试通常不拆开。
- 优先从验收标准拆出端到端场景，不机械按前端、接口、数据库分层。“独立”允许前置依赖，不要求可并行。

优先验证高风险假设，稳定共享契约；前置重构仅覆盖后续交付所必需，保持中间版本可运行。

### 执行顺序

普通 Change 默认按任务编号数值递增串行执行，例如 `T1 → T2 → T10`，不取 JSON 属性顺序或正文排列。前面的任务全部为 `done` 后才能开始或完成后续任务；small 同样遵循此规则，xlarge 按子 Change 组织。

需要并行或特殊安排时，在 Plan 中唯一的“执行顺序”章节提供一份“任务 / 前置任务”表，完整覆盖 JSON 任务，无前置时写“无”。该显式表覆盖默认串行安排；仅有标题或文字说明仍采用默认。表格存在但无效时修正声明，不能忽略它退回默认。前置关系只在此表维护，不在任务正文或 JSON 另设顺序、并行组等字段。

前置已满足且实现边界独立的任务允许并行，不强制同时运行。前置关系既表达交付依赖，也表达执行安排；共享文件、契约或资源等要求串行时，应把先执行的任务列为后者的前置任务。不同执行路径分别按各自前置条件推进，不额外等待无依赖的任务。

显式执行顺序表示例：

| 任务 | 前置任务 |
| --- | --- |
| T1 | 无 |
| T2 | T1 |
| T3 | T1 |
| T4 | T2、T3 |

### 编号与调整

任务在 Change 分支完成验证、记录为 `done` 并提交推送后，冻结编号、定义和完成记录；返修追加新编号，不退回 doing、不复用旧编号。在此之前可以修改、拆分、删除或重排任务，Plan 文档或任务分支上的实现检查点不触发冻结。

任务编号使用正整数 T1、T2……，新增时递增，不复用删除或已用编号。返修在 Plan 和 Execution 中关联原任务，不覆盖历史验证结论。调整后核对 Plan 与 JSON 编号、标题一致；有显式表时核对覆盖完整、任务唯一、前置存在且无自依赖或循环。首次计划应覆盖完整 Requirement，且没有方案级未决项。共享顺序规则在 `scripts/task-order.mjs`，流程命令与工作台共用；执行、任务开始/完成及关闭步骤会重新检查实际安排。

## 执行

开始前按[读取现状](#读取-change-现状)核对状态与有效确认，读取本任务相关的 Requirement、Technical、Plan、Execution、Specs 和项目规则；满足[阶段推进](#阶段推进)的执行条件后再实施。

### 单任务循环

1. 按默认编号串行或 Plan 显式安排选择就绪任务，核对前置链上的任务已完成。用 `task-start` 将任务设为 `doing`。
2. 复用项目模式，完成最小可验证交付并保持中间版本可运行；运行与改动相称的测试、类型检查、构建和必要交互验证；无新变化或疑点时不重复已有成功检查。
3. 对照 Requirement、Technical 与任务验收核对交付，将摘要写 `verification`；较长证据按任务编号写 Execution，记录范围、命令、结果和未验证限制。
4. 验证通过后，用 `task-complete` 记录真实验证，将实现与 `done` 记录一起提交推送，成功后才算完成。提交失败时将工作区和暂存区中的任务恢复为 `doing`，移除尚未成立的 `commitTitle`，保留代码与证据；推送失败按[提交与推送](#提交与推送)处理。

同一分支串行推进，当前任务的实现或状态检查点提交成功后，可切换到其他就绪任务；并行实施使用任务分支与隔离工作区。未完成任务保留 `doing` / `blocked`，可提交真实状态与证据；可运行的中间实现需先调整成独立交付。所有任务完成后按[阶段表](#阶段推进)进入 close。

发现技术缺口时停止受影响实施，设置 `blocked`，在 `reason` 写证据与解除条件，解除后移除原因；继续调查，其他不依赖未确认行为或契约的任务可继续。`commitTitle` 建议用 `<id> T<n>:` 开头，不为记录提交 hash 另造提交。

### 任务分支

只在有并行收益且实现边界不重叠时使用，一个任务至多一个分支：在 Change 分支把任务设为 `doing` 并填写 `branch: task/<id>/T<n>`，提交推送后，从包含前置交付的 Change 分支创建任务分支。

任务分支可有多个提交；验证后普通 merge 回 Change 分支，在合回提交中更新 `done` 与验证摘要，再推送。冲突或涉及其他任务的调整在 Change 分支处理，实质冲突按[合码](#同仓库合码)记录。

## 确认、等待与返工

已有明确确认直接沿用；已确认范围内的推进与普通等价调整无需逐任务审批，只为尚未授权、改变目标、关键方案或风险的决策增加确认。创建后的阶段确认前，准备并推送可审阅结果，在会话中说明待确认事项和对应要求，暂停受影响实施。

确认记录使用实际发生时间和摘要，可附来源，不预填确认，不把当前提交 hash 写进同一个提交。

等待时填写 `waitingFor`，摘要说明解除条件，解除后移除。等待与返工不改变 `active` 状态；无等待项不等于已获确认。

返工直接修订原正文和 JSON，不另建返工文档；`rework` 记录当前或最近一轮的时间、原因与处理方式，回到最早受影响阶段：

| 变化 | 确认和任务处理 |
| --- | --- |
| 需求实质变化 | 移除失效的 requirement、technical、plan 确认 |
| 关键技术方案变化 | 保留有效需求确认，移除失效的 technical、plan 确认 |
| 已确认范围内的实现修正 | 保留有效确认，修改未完成任务或追加返修任务；执行中回到 execution，尚在规划时留在对应规划阶段 |

返工时按[规模调整](#规模调整)复核实际影响。清除失效的等待和关闭结果，实现或行为变化后重新执行验证、验收及后续关闭步骤。用户新指令明确确认的部分可直接记录，文字澄清不自动使确认失效；已归档交付的返修创建新 Change。

## 关闭与 Specs

含非空 `previews` 的 Change 在归档提交后按 [Prototype 子 skill 的归档规则](./prototype/SKILL.md#归档) 推送保留标签；分支和标签都经远端核实后才能报告归档交付完成。无关联的旧 Change 保持原流程。

按 **整体验证 → 验收 → Specs 同步 → 归档提交** 顺序执行。small 默认由 Agent 自验收并直接归档，medium / large / xlarge 等待人工验收；用户明确要求人工验收的 small 也进入人工验收。`closure` 各步按实际结果填写，未完成不预填成功。

### 整体验证

核对确认仍有效、Plan 与 JSON 一致、任务均已验证并提交推送、无未解释阻塞；运行与改动相称的整体验证，覆盖需求、验收、必要失败路径及边界，记录实际证据。xlarge 父 Change 要求全部子 Change 完成或取消，并已同步守护分支。

| 规模 | 评审要求 |
| --- | --- |
| small | Agent 自查 |
| medium | 默认独立评审，用户可免除 |
| large | 必须独立评审，用户可亲自评审代替 |
| xlarge | 父 Change 核对整体目标与跨子 Change 集成，不重复子 Change 评审 |

独立评审与实现上下文隔离（如 subagent），覆盖整个差异、需求与验收对应及测试证据；在 `closure.verification.summary` 记录评审方式，需跟踪的问题写 Review。

通过记 `verification.result: passed`，进入 active / close。默认 small 继续自验收、Specs 同步与归档，不设置人工验收等待、不在此处结束交付；需要人工验收时设置等待项并提交推送。失败记 `failed`，按最早受影响阶段返工。

### 验收

small 自验收时，Agent 对照 Requirement 逐项核对交付与证据，确认仍符合 small 范围且没有未解决的验收项，记录 `acceptance.result: accepted`。摘要明确写“Agent 自验收通过”及实际依据，`source` 记录 small 直接归档规则或用户的明确授权，不写成用户已验收。随后完成 Specs 同步和归档提交推送，一次报告结果；验收未通过时按返工规则处理。

人工验收时，向用户提供实现摘要、验收对应结果、验证证据和已知限制。实际验收或用户明确要求将该交付合入守护分支后，用 `accept --mode user` 记录 `acceptance.result: accepted`，摘要引用原话或附 `source`；显式合入指令按已有授权执行，不再次索要同一确认。测试通过和事先“做完就行”的笼统指示不等于人工验收。

需要人工验收但尚未验收时保持 active / close 和等待项，不同步 Specs、不归档；需修改时按[返工规则](#确认等待与返工)处理。

### Specs 同步

Specs 以任意深度的稳定业务能力树组织，完整相对路径是能力身份，每段使用小写 kebab-case；含 `spec.md` 的路径代表能力，其余是命名空间。父级写共同行为和边界，子级写细节；不按页面、技术层或源码目录机械拆分。核心技术方案写在其约束的能力下，跨能力方案可用独立路径；移动或重命名时同步引用。

以最终验收实现为准，重读当前 Specs，对照 Requirement 的 ADDED / MODIFIED / REMOVED 和 Technical 中的长期核心方案，按能力路径合并：

- 只描述已实现、验证且仍有效的产品行为，以及架构、共享契约、数据模型、安全边界等长期约束；未来目标留在 Change。
- 用当前时态，不放 Delta、任务状态、评审过程或变更日志。普通技术修正、重构、性能调优、实现细节和恢复既有行为的缺陷修复不写入 Specs。
- 保留无关内容，涉及 API、数据或共享契约时核对对应文档；发现冲突或实现不一致时停止归档。
- 仅纠正文档对当前实现的错误描述或补录既有行为时可直接改 Spec；改变实现则通过 Change。新项目首次 Change 关闭时才产生第一批已实现 Specs。

同步后记 `specs.result: synced` 和影响范围；无需变更时记 `not_needed` 并说明理由。

### 归档

前三步成功且证据仍适用后，将完整目录移动到 `docs/project/archive/YYYY-MM-DD-<id>/`，目标冲突不能覆盖，并确认源目录已不存在、目标材料完整。记录 `archive.result: done` 与 `path`，设置 `status: completed`、`stage: close`，移除等待项，将 Specs、最终 JSON 和目录移动一起提交推送。

尚未提交归档而需再改实现时，先移回 changes、恢复 active 并返工；已提交归档只读。

当前 Change 关闭不等于整条分支可合入；分支内全部 Change 的归档条件见[合码](#同仓库合码)。

归档提交推送成功、必要的原型保留标签经远端核实后，先按[同仓库合码](#同仓库合码)完成预检，再主动询问用户：直接合入 `main`（或项目实际目标守护分支）、发起 PR，还是暂不处理。提供归档提交、目标分支及预检结果；若有未归档 Change 等阻塞，说明解除条件。已有明确选择时沿用，不重复询问；归档本身不授权合入或创建 PR，选择 PR 也不授权合并 PR。

## 取消 Change

用户取消时设置 `status: cancelled`，记录 `cancellation.at`、`cancellation.reason`，移除等待项，保留当前阶段、任务、正文与代码。不回滚、不补齐剩余文档或任务、不同步 Specs、不归档。

只提交推送取消记录及必要说明，已有未提交实现原样保留并向用户说明，不伪装为完成任务或混入取消提交。随后冻结该 Change 分支及其任务分支：保留在中心仓库，不删除、不开发、不合入；只允许完成取消检查点或修复其提交、推送失败，不能把 cancelled 改回 active。

继续其他工作从不含未归档 Change 的最新守护分支另建分支 / worktree，优先独立 worktree 以免搬动未提交修改；转用代码在新 Change 下重新确认和验证。取消 xlarge 父 Change 时确认未完成子 Change 是否一并取消。

共用分支中，进入过开发的 Change 取消会冻结整条分支，其余规划文档复制到新分支继续；仅在规划阶段取消的 Change，推送取消记录后可从共用分支移除，记录留在 Git 历史中。

## 同仓库合码

合码本身不创建新 Change，仅处理同一 Git 仓库内分支或 worktree。

| 方向 | 方式与条件 |
| --- | --- |
| 任务分支 → Change 分支 | 普通 merge，不 squash；任务已验证，合回后更新任务状态 |
| 守护分支 → Change 分支 | merge；Change 分支未取消 |
| Change 分支 → 守护分支 | 可以 squash；整个源提交没有未归档 Change，已有合码授权 |

先只读核实仓库、源目标分支、worktree、目标守护分支的 workflow 配置、两侧提交、merge base、工作区与相关 Change / Specs，`git fetch` 后以中心仓库提交为准。用 diff、log 和可用的 merge-tree 评估文本与语义冲突，不在含用户修改的工作区试合并。

普通可机械处理的差异按既定方案解决。有大量冲突、行为分歧或共享契约变化时，在尚未归档 Change 的 `merge-technical.md` 记录确切源 / 目标 / base 提交、需保留的行为、冲突决策、顺序、失败恢复和验证方法。只对新决策请求确认，用 `confirmations.merge` 记录时间摘要，可附三侧提交。实质改变需求或方案时按返工规则更新原文；新的实现修正追加任务。

先在 Change 分支完成同步、必要返工和正常关闭，再合入守护分支。预检后任一提交变化都重做相关检查；仅提交号变化且无实质差异时沿用有效决策。

合入守护分支前固定源提交，整个提交的 `docs/project/changes/` 下不能有任何文件，不以当前 Change 或其 status 为限。核对目标最新提交、实际合并结果和相关代码检查，结果树也必须满足此条件。

已有授权且检查通过后合并；未授权时先准备具体可审阅结果，再请求最终授权。最终集成证据留在 Git / CI，不改只读 archive。目标变化需实质返工时，从最新守护分支建新 Change；旧交付尚未合入时可把已归档提交纳入新分支，再验证与归档。

## 提交与推送

使用工作流推进 Change 即包含 Change / 任务分支上的提交推送。文档形成可审阅版本、收到确认、阶段调整、阻塞、任务完成、取消和归档都及时形成检查点，本轮结束前提交。同轮相关正文与状态一起提交，只暂存相关文件，保护用户修改，不做空提交、不跳过 hooks。

每个检查点提交后立即推送同名分支，请求审阅或阶段确认前相关文档应已推送；创建前简短确认除外。提交失败保留工作区，用 `task-retry` 恢复尚未提交的任务状态，见[执行](#执行)；推送失败保留本地提交、修复并重试，如实报告未同步。

合码方式见[同仓库合码](#同仓库合码)。Change 与任务分支不 squash、不改写已推送提交，未推送的本地提交可 rebase；合入守护分支后保留 Change 分支，任务分支合回后可删除。创建 PR、合入守护分支、发布或改写历史按用户已有授权执行，关闭本身不隐含这些授权。

完成操作后说明实际结果、位置、验证及提交推送状态；关闭时报告 Specs 范围与归档提交，取消时说明代码保留、分支冻结与取消记录。未完成、未验收或未推送时不宣称完成。
