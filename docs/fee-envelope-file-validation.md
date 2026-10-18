# 第七十二轮：独立只读封套文件模块

2026-10-19。承接[协议设计](fee-envelope-design.md)，交付[领域类型](../src/domain/fee-envelope.ts)、[严格JSON](../src/data/fee-envelope-json.ts)、[文件/历史API](../src/data/fee-envelope.ts)、[外层Schema生成器](../src/data/fee-envelope-schema.ts)、[离线Schema](../schemas/fee-envelope-1.0.schema.json)及[真实格式测试](../tests/fee-envelope.test.ts)。没有工作台入口、应用函数、事务提交、自动缓存/恢复、客户或内部新导出；API只返回独立候选和只读核对，不安装状态或写费用。

## 文件与API

新文件`INTERNAL_FEE_APPLICATION_ENVELOPE / 1.0`与项目0.8/0.9、配对1.0/1.1、成分1.0及精度1.0分别独立。现有项目版本及旧模板不升级。外层严格包含kind/version、envelope_id、business_id、revision、history_origin、current_sources、ledger_json、archives和content_sha256；未知活动字段或未来版本拒绝，不退回旧项目导入。

| API | 行为 |
|---|---|
| parseFeeEnvelope / validateFeeEnvelope / serializeFeeEnvelope | 严格解析文本/对象、重算来源和全部历史闭包，返回脱离调用方的完整文件或原文；另存不换身份/历史 |
| adoptLegacyFeeEnvelope | 明确输入完整当前来源，创建UNKNOWN_IMPORTED候选。历史未知不补“全未消费”，无调用方可选known/verified字段 |
| createNewFeeEnvelopeFromPair | 明确新业务名称/时间，经既有业务复制API重建配对、账单/行、拟建目标及新封套/业务身份；撤销已知确认，新成分/精度空记录 |
| copyFeeEnvelopeForNewBusiness | 对当前一致配对产生独立新业务候选；已应用后原CREATE_NEW配对失配时拒绝，不静默改操作或换内嵌项目 |
| updateFeeEnvelopeSources | 仅替换当前原文，保留完整历史、归档、退休身份；不变不递增，文字/空白变化递增，十亿上限拒绝 |
| reviewFeeEnvelope | 保留当前配对/成分/精度核对，独立报告历史状态、已消费来源和当前payload是否仍相符；没有ready或应用资格 |
| inspectFeeEnvelopeConsumption | 仅在当前谱系查business_id+bill_id+line_id；UNKNOWN、RECORDED_IN_THIS_LINEAGE或NOT_RECORDED_IN_THIS_LINEAGE，不是现实订单全局证明 |
| compareFeeEnvelopeRecovery | 冻结两份完整原文/指纹，比较身份、修订、历史前缀/原点及退休集合；只给候选状态，install始终false，latest_proven始终false |

对象变更租约为envelope_id、business_id、revision及content_sha256四项；对象和编辑输入在首个异步hash前复制。原文恢复另保留原始文件及SHA，不把外层JSON排版变更当新业务或新消费。操作代次、迟到读取、跨标签冲突和保存取消需要后续控制器实施，本模块不声称已提供UI竞态保护。

current_sources为五个明确槽：project_json、bill_json必须完整，pair_json、attachment_json、precision_json可明确null。所有非空来源均由真实既有解析器验证；有效但失配或缺父来源时保留原文并报告，不自动补造/重绑。旧项目0.1–0.9原文照存，既有解析器内部的兼容投影不会被本模块重新落盘覆盖。旧同名扩展继续惰性，不作为业务身份/历史来源。

## 清单、归档与真实历史重算

ledger_json为`INTERNAL_FEE_APPLICATION_LEDGER / 1.0`：business_id、history_origin、genesis_ref、有序receipt_refs和累计retired_cost_ids。外层身份/原点必须一致，revision不小于回执数+1。UNKNOWN_IMPORTED只支持未知原点、无执行回执；不能装入一段新回执伪装已知完整历史。NEW_DECLARED只是本地独立业务的明确声明，不认证现实订单。

archives每条仅sha256与raw_json；SHA绑定原始UTF-8字节，同文可共享，重复条目拒绝。引用角色来自明确槽位，必须真实解析为项目、账单、配对、成分、精度、payload、ledger、plan或receipt。遍历完整闭包，缺引用、错角色、环、孤立条目和过深图整体拒绝，不截历史或跳过坏行。

- payload格式`INTERNAL_FEE_APPLICATION_PAYLOAD / 1.0`严格保留project_json与bill_json；前/后都是完整原文，不包含回执自身。
- plan格式`INTERNAL_FEE_APPLICATION_PLAN / 1.0`包含business_id、transaction_id、五类source refs、before_payload_ref、before_ledger_ref和完整有序rows。每行保留mapping_id、bill_id、line_id、cost_id和operation，批内来源与目标各自唯一。
- receipt格式`INTERNAL_FEE_APPLICATION_RECEIPT / 1.0`包含business/transaction、sequence、previous_sha256、plan/before/after payload/before ledger refs、rows及entry_sha256。entry摘要排除entry_sha256自身；归档SHA另含完整回执原文。previous_sha256明确引用前一回执的归档SHA（首项为原点payload SHA），不混用两种摘要。
- 提交前ledger必须等于该位置的完整历史前缀、同一原点与身份，退休集合不得减少；事务ID不可复用。每个plan/receipt对应行和前状态引用必须完全一致，五类来源的项目/账单原文须等于该次前payload原文。
- 真实调用只读提案，重新核对配对、成分、政策、回执、原金额、CORE精度、部分C/抵扣、包含/重叠及付款/承担。只将该旧API固定的四项“未接应用/业务身份/历史”描述交由本模块独立核对，其余问题原样阻断，不忽略未知新问题。
- 在私有副本中重建**仅追加明确CREATE_NEW费用**的预期项目，核对历史后项目与之完整相符，账单原文不得改变；REFERENCE_EXISTING不追加费用或消费。按未经内部升级的原始JSON字段比较，包括schema_version。任何其他费用、版本、报价、扩展或账单改写即使全部hash重新计算也拒绝。重建只用于验证历史，不返回可执行写入补丁。
- 再调用现有核心责任解析器核对实际归属；cost.responsibility字段不能覆盖核心规则或方案约定。实际归属、明确付款/承担与记录矛盾时阻断，不为使文件通过而改原规则。

历史消费按business+bill+line，忽略mapping、目标或新事务ID。已消费来源、曾创建目标或退休目标不能再CREATE；只读引用可留审计但消费数0。删除当前费用不删除历史，不重放旧回执。允许原点到首次事务、两次事务之间存在人工资料编辑，不强求前次后payload等于下一次前payload；该次来源与前后快照仍全部重验。

当前资料可以已变化，原历史按当时冻结来源验证并保留；相对当前的PROJECT_SNAPSHOT_MISMATCH及HISTORICAL_PAYLOAD_DIFFERS_FROM_CURRENT独立报告。历史结构通过不清除当前来源/政策/税务待办，不证明实际付款、抵扣资格或已发生真实业务。SHA是可重算的一致性摘要，不是签名；没有当前锚点时仍无法证明文件最新，手工重写并重算整份文件也不能靠SHA识别现实真实性。

## 本轮修正与兼容

修正[独立只读提案](../src/data/fee-application-proposal.ts)的配对1.1复核：人工记录绑定业务快照，应与containerCostPairBusiness(pair)比较，与既有配对控制器口径一致；此前使用含review_plan的外层快照会误报STALE_BUSINESS_BASIS。新增真实历史1.1及独立断言覆盖，实际当前项目变化仍报告失配，没有删除真实阻断。该提案尚未接运行工具，旧金额、费用归属规则和运行产物保持。

旧提案history_json接口仍不识别新封套，继续明确未知格式。本轮不把新结构核对结果当作调用方可填verified标记；后续适配必须由独立验证上下文完成。没有伪造执行回执的公开创建/追加API，也没有发布带“已应用”历史的业务模板；测试夹具中的回执只是合成不受信任输入。

## 边界与验证

UTF-8外层128MiB、归档512条、回执64条、批次50行、退休目标3200条、修订1至10亿；JSON逐层深度32/节点300000，归档图最长32边，源格式限额保持。payload上限32MiB、ledger5MiB、plan/receipt各1MiB。多项约束同时适用，深层历史图或转义后的外层可能早于条数上限拒绝，不承诺64笔或各子文件上限能同时装入。超限整体拒绝并保留调用方输入，没有截断或修复清历史。未进行128MiB整文件压力/浏览器内存实测。

逐层拒绝重复及转义同名JSON键、坏UTF-16、非有限数、未来格式/活动字段、原型/访问器/符号/稀疏数组/循环；对象getter不执行。离线Schema只验证外层形状，字节上限、真实来源、闭包、角色、回执和前后差异必须运行时核对。

新增73项真实文件/API测试，完整101文件3934项。覆盖配对1.0/1.1、未知历史、原文往返/冻结/别名、独立新业务、旧扩展/版本、有效合成历史与只读引用、删除不重开消费、重复事务/来源、完整hash重封后的前后差异/计划篡改、失效精度回执、原文错配、实际归属矛盾、人工编辑、严格JSON/坏对象/资源限制、UTF-8源大小、最长历史路径、租约/上限、恢复旧修订/分支/无锚点。固定[设计检查器](../tools/check-fee-envelope-design.mjs)仍为98/31场景、15叶变更/8身份变体/2指纹，与生产测试分别统计。

类型、全部独立设计、UI审计、证据链接、单文件和Schema/模板重建一致性纳入CI。旧核心计算、原测试、依赖、旧Schema/模板及合成演示保持；只新增独立文件路径和修正上述未接入的提案口径。工具Git blob保持`08dbb99d49463f8e58dc20f91244e2d5ea6a4bc3`，合成进口演示保持`e2df8698239dc2210d99587bb87e92bf05f9e46a`。介绍页做file/HTTP及1440/768/390/320检查，发布后另核对四个正式URL字节及展示；历史39套业务浏览器流程/精度40项/下载并非本轮重跑。

下一阶段先实现独立交接与内部审计，再做恢复/保存控制器、运行入口和真实浏览器竞态/客户隔离；最后才接完整聚合费用提交。真实手机、真实单据和专业复核按安排继续暂缓，见[阶段目标](development-stages.md)。
