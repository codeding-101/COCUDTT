# 核对记录层：格式与验收（第四十三轮）

2026-10-15。本轮交付独立记录层0.1、严格JSON读写与离线Schema；尚未接入页面、自动草稿、恢复或内外报告，也未启用配对1.1。原配对1.0、项目0.8/0.9、账单1.0及实际费用保持。相关核对范围沿用[只读模块](container-cost-review-module-validation.md)，不新增税务计算。

## 为什么分开业务快照与记录修订

确认依据若包含确认记录自身，会产生循环；若每次确认都改变其他记录的依据，多条记录将无法同时有效。本轮因此采用两个层次：

- `basis`绑定完整配对1.0的pair_id、revision、content_key、当前术语及账单review_date。完整业务快照包括项目、账单、映射、选择及未知扩展。
- 独立`plan_id/revision/content_key`保护记录编辑、删除、确认的并发租约。每条来源键绑定plan_id、业务basis及该条完整记录（不含其evidence），不包含其他记录或计划revision。

因此，编辑一条撤销这一条的确认，确认/删除另一条不误伤它；任何业务快照变化使整份计划待复核。显式同业务重绑保留所有原文和目标，清除全部已知确认键、USER_CONFIRMED降为UNVERIFIED、EXAMPLE保持；已删除/失效目标不自动重定向。新业务副本不能重绑旧计划，应从空记录创建。

content_key及来源键均为可重建的一致性记录，不是认证签名。即使结构和来源确认通过，结果仍只标为RECORDED_ASSUMPTION，不表示事实真实、专业认证或费用就绪。

## 五类记录与范围

| 记录 | 资格与边界 |
|---|---|
| QUOTE_INCLUDED | 目标为当前映射完整三元组（mapping_id/line_id/cost_id），当前只读结果已有包含记录；保留原报价推导/提案旗标性质，不自动排除海关加计 |
| FULL_PARENT_INCLUSION | 当前映射及明确父项、coverage=FULL；父项存在、活跃、同币且无环；未应用提案父项、自引用、失效、部分包含及不支持关系拒绝；全额覆盖仍是有来源的用户假设 |
| DIFFERENT_CHARGE_CONTENT | 当前账单行对或已有费用候选，左右服务说明非空且NFC规范化/去空白后不同；说明不同不证明服务真实不同，不自动扣减 |
| DISJOINT_COVERAGE | 仅当前模块已证明精确箱号文本或选中日期集合不交的行对；缺条件、固定/混合事件、方向不明或箱日交集不能记为程序证明；不是全局无重复证明 |
| KEEP_RECORDED_AMOUNT | 当前可计算账单行及完整映射；记录保留原值、不作税务调整的假设。含税、税率引用、6位精度损失及海关成分待办原样保留 |

所有记录都要求非空说明；来源可以未完成或EXAMPLE保存，明确确认操作才校验来源定位、有效期、核对日期及完整记录键。有效期须覆盖review_date，checked_on不得晚于review_date。缺资料不补造，未来日期/示例不能确认。

行对要求UTF-16规范顺序，反向输入拒绝，不能静默交换左右服务说明；目标匹配采用结构化数组，不使用可歧义的分隔符。相同目标/同一方面只有一条记录，覆盖方面的DIFFERENT与DISJOINT互斥；报价和金额两方面可分别记录。更改同一方面保留record_id并撤销确认；换目标应显式处理旧记录，不自动搬迁。删除保留退休ID，不静默复用。

本轮没有IGNORE、税额抵扣、金额舍入、部分分摊或费用应用选项。确认不清除只读模块、提案或原候选的任何待办。

## 格式与API

`INTERNAL_CONTAINER_COST_REVIEW_PLAN` 0.1仅是内部记录对象，不是项目/账单/付款或配对容器，打开入口不能混用。内容包括kind/version、plan_id/revision、basis、records、retired_record_ids及content_key。没有通用空文件模板：新计划必须从当前完整配对创建，不能编造业务快照。

```ts
const plan = createContainerCostReviewPlan(pair, pair.content_key);
const edited = setContainerReviewRecord(plan, plan.content_key, pair, input);
const checked = confirmContainerReviewRecord(edited, edited.content_key, pair, recordId);
const text = serializeContainerCostReviewPlan(checked);
const restored = parseContainerCostReviewPlan(text);
const report = reviewContainerCostReviewPlan(restored, pair);
```

另提供明确删除及同业务重绑API。操作先验证完整输入和预期内容键；失败保留原对象，不写项目。新建/编辑/确认仍重算当前只读边界，不接受调用方伪造结果。记录租约变旧拒绝覆盖，记录修订上限10亿不回绕。

记录和退休ID分别最多2000，超限整份拒绝；JSON需无损、无getter/符号/循环/稀疏数组等，输入及输出受10MiB、深度/节点限制。确认来源键最多1MiB，较大业务可能无法确认，保留待办且不截断；恶意短伪造键先判为不匹配，避免为每条重复构造巨大业务上下文。

[第六份离线Schema](../schemas/container-cost-review-plan-0.1.schema.json)由同源生成器产生，描述结构；规范行序、重复方面/跨ID、完整内容键、目标资格与来源适用性须运行时检查。原五份Schema及模板保持字节不变。独立记录有内部来源与业务内容，不进入客户输出。

## 验证

基线64文件2163项；新增90项，完整65文件2253项通过。覆盖五类记录往返、Schema、EXAMPLE及有效期/未来日期、编辑仅撤销本条、不同记录确认/删除互不误伤、业务金额/术语/来源/映射/报价/汇率/日期/扩展变更失效、显式重绑/失效目标保留、新业务拒绝继承、篡改再重建内容键仍失效、全额父项反例、不能捏造不同服务或范围不交、嵌入分隔符ID、缺失金额、退休编号/并发/上限/安全JSON和原分析不变。

2000记录完整读回并全部列明待办，2001整体拒绝；退休ID同样核对。原独立设计32手算/26拒绝输入、期间14/16另列，不混入Vitest。27套Edge离线流程重跑，原账单32项、配对31项、编辑35项、副本33项及1440/768/390/320模拟宽度保持；0未处理异常。类型、93动作绑定、构建/资源一致性与依赖审计通过，0漏洞，无新增依赖。PR及合并main的Windows/Linux CI按实际提交分别核对。

本轮原计算/界面/离线工具及旧五份Schema/模板保持，不把纯API层当作已经接入页面或完成真实业务验收。真实手机、实际单据和人工专业复核继续暂缓。

## 下一阶段：配对1.1和完整接入

拟议1.1需显式启用，将记录与业务一起交接；核对basis应使用不含review_plan的完整1.0业务投影，不把记录自身放入确认依据。业务revision负责业务更新，记录revision负责记录变化；整体容器内容键仍保护所有内容，业务更新必须清除/失效旧记录确认。这个投影规则本轮尚未在解析器启用，当前1.0继续拒绝1.1及未知活动字段。

接入时同轮验证版本/同名扩展保护、界面来源确认与待办、记录草稿、打开/另存竞态、取消/失败恢复、业务复制清除、Schema/内部报告/Excel及客户隔离，再独立验收税务/精度选择和费用原子应用。本轮更新README/main，公开网站保持原发布。
