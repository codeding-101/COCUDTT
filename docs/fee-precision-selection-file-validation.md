> 本文保留第六十六轮文件模块验收基线。第六十七轮已实现[独立交接控制器、编辑/草稿与内部审计](fee-precision-selection-controller-validation.md)，尚未注册工作台；下文未实现/下一阶段表述按当轮阶段理解。

# 第六十六轮：精度选择独立文件模块验收

2026-10-18。依照[上一轮设计](fee-precision-selection-design.md)，实现[领域类型](../src/domain/fee-precision-selection.ts)、[严格JSON边界](../src/data/fee-precision-selection-json.ts)和[文件/核对API](../src/data/fee-precision-selection.ts)。独立`INTERNAL_FEE_PRECISION_SELECTION / 1.0`已可由开发API读写；没有注册工作台、自动草稿、恢复控制器、内部HTML/Excel输出或费用应用。

## 已实现行为

| API | 行为 |
|---|---|
| create / parse / validate / serialize | 完整配对与成分附件原文、三层严格JSON、双来源SHA-256和外层规范内容指纹；独立文件，不安装项目或附件 |
| addFeePrecisionSelectionRecord | 只收组件ID、通道、choice；从真实附件调用reviewFeeTaxComponent重算原精确分数、捕获完整目标/币种，不接收调用方original或candidate |
| setFeePrecisionSelectionChoice | 只改政策；目标/槽位/原值不编辑；真变更仅清该条政策回执，原文等价但尾零不同仍算变更 |
| acknowledgeFeePrecisionSelectionRecord | 完整当前双来源、活动服务费目标、原成分与明确政策逐项核对；未知/孤立/失配不确认；已是当前回执则幂等 |
| rebindFeePrecisionSelection | 同pair_id和attachment_id新原文明确重绑，全部旧回执撤销；保留历史original/target/choice，失配不自动重取或连接同名目标 |
| remove / copyForNewBusiness | 删除ID退休；新业务要求新配对和新附件身份，仅产生新身份空记录，原业务保持 |
| reviewFeePrecisionSelection | 实时重算原成分和ROUND/FX候选/正负差额/审计；来源状态、政策状态、原附件核对/业务待办分别输出，无ready/apply/资格状态 |

政策回执仅记录算术假设。原附件EXAMPLE/USER_SUPPLIED和来源回执分别保留，不迁移为专业认证；原金额失配、包含/重复、税务待办及`PROPOSAL_CORE_PRECISION_LOSS`不因记录政策而清除。明确零仍是0/1，未知仍是null；未知抵扣不推定费用净额，未知海关成分不从其他列补造。

一个原成分/通道一个活动槽位，最多48条、500退休ID；完整租约revision/content_sha256防旧修订更新，修订上限不回绕。回执自身与外层修订不进入政策basis，单条确认不误伤其他条；完整原附件中的修订/来源回执变化则使全部政策待复核。SHA可以重算，不是签名、真实单据或跨标签事务锁。

FX只存目标币种/用途/来源/日期/政策，from/amount/channel从记录构造；复用既有精度API验证商业与海关诊断边界。旧as_of可随重绑保留为历史政策，但与新账单review_date不同时不能确认。没有三角换汇、默认汇率、自动税务分离、合计差额分摊或费用应用。

## 格式与生成资源

新增[离线Schema](../schemas/fee-precision-selection-1.0.schema.json)及两份固定模板：[空精度记录](../templates/fee-precision-selection-empty.json)、[算术示例](../templates/fee-precision-selection-synthetic-example.json)。**两者均绑定固定合成配对/成分来源**；空模板只表示精度records为空，不是空白真实业务。示例保留1.0050001 USD及CORE精度待办，原成分按合成13%比例推导、商业换算比例7，全部来源为EXAMPLE、无政策回执；不代表实际税率、汇率或合同。

资源由[固定生成器](../tools/build-fee-precision-selection-templates.mjs)经真实API与校验生成，接入既有build:catalog；固定身份及规范指纹可重建，不读取当前交易、草稿或任意用户文件。不能通过现有打开项目/配对入口混用这些文件。Schema只描述结构，不能代替运行时的重复键、既约分数、日历、来源指纹和业务引用校验。

JSON边界在新命名空间采用与原成分附件一致的严格算法，限额为本格式64MiB；旧附件24MiB入口及其实现保持，避免扩大旧格式允许范围。每层检查解码后重复键、UTF-8与代理项、深度32/节点300000；对象接口先检查描述符再复制，不执行getter，不接受类/自定义原型/循环/稀疏或扩展数组/符号/非有限值。

外层64MiB、内嵌附件24MiB、独立及附件内配对10MiB分别限制；转义和稳定排版后的外层也须通过上限。实际测试执行超64MiB文本长度拒绝、超过旧24MiB的新对象复制及新64MiB对象拒绝、实际10/24MiB来源超限拒绝，UTF-8临界字节用较小可配置上限核对。没有宣称接近所有上限的业务性能、内存或浏览器存储验收。

## 本轮测试与发布边界

- [完整来源与生命周期](../tests/fee-precision-selection.test.ts)：真实配对1.0/1.1、循环分数重算、独立指纹/basis、零/未知、精度原待办保留、局部/全部失效、源回执变动、历史FX日期、孤立目标、删除/新业务、异步输入冻结与旧计算兼容。
- [严格JSON测试](../tests/fee-precision-selection-json.test.ts)：三层重复键和指纹、UTF-8/代理项、访问器与原型/数组、深度/节点/实际大小、嵌套坏文件整体拒绝。
- [边界测试](../tests/fee-precision-selection-boundaries.test.ts)：原分数、政策/FX、额外可信候选拒绝、唯一槽位/退休ID、48/500边界、修订上限和异步多处同时失败不产生未处理异常。
- 新增**168项**，完整**93文件3663项**。旧81/60状态设计及50/51单叶变更、53/75数值设计与4860/124仍独立检查，固定fixture不修改，不与应用测试相加。

类型、155动作/43字段/46路径、既有设计、合成进口演示、证据链接、单文件构建和旧Schema/模板一致性另验。三个生产文件保持独立，检查器限制它们不能进入现有UI或旧计算路径。旧生产源码、旧测试、旧Schema/模板、依赖和运行工具保持。

运行工具Git blob仍`1ebefb32b85d1060234d48c09387a8a46fd41462`，合成演示仍`e2df8698239dc2210d99587bb87e92bf05f9e46a`。本轮静态说明file/HTTP四宽度、正式URL哈希与原生浏览器结果及双平台CI记录在本轮PR；第六十二轮38套/220项业务浏览器证据是历史，不冒充本轮重跑。没有新界面，不能声称新文件的浏览器下载、草稿恢复或客户真实导出隔离已验收。

## 下一阶段

先实现独立交接控制器：已提交文件与未提交编辑分别存草稿，冻结保存/取消失败、迟到读取、完整租约/来源失配、跨标签冲突和原文备份；内部快照重算并保留差额与原待办，客户真实HTML/XLSX/PDF以完整哨兵验证隔离。之后接工作台与离线/窄屏完整流程，最后验收费用映射、原子应用和失败回滚。真实手机、真实业务和人工专业复核按用户安排继续暂缓。本轮未新增税制或法规结论。
