# 项目 JSON 格式与结构 Schema

集装箱账单另有独立`INTERNAL_CONTAINER_BILL` JSON **1.0**和[Schema](../schemas/container-bill-1.0.schema.json)，不是项目或付款文件。工具独立面板可打开/另存、恢复草稿及下载Schema/两模板，内部HTML/Excel记录快照；未完成/不支持条件可留存，只读已有费用，不自动写成本。详见[格式边界](container-bill-file-design.md)及[界面接入](container-bill-ui-validation.md)；项目默认0.8和显式运输关联0.9语义保持。

内部付款计划采用独立`INTERNAL_SETTLEMENT_PLAN` JSON 1.0，须单独保存/打开，不属于0.8项目或自动草稿；刷新或打开项目后重置。内部HTML可记录付款快照，客户文件不自动读取；详见[付款计划格式与边界](settlement-validation.md)。

当前保存格式为 **0.8**，支持结构兼容的 0.1–0.7 容器导入。文件是标准 JSON，不是客户报价说明；可能包含内部成本、来源与完整输入，应按内部资料管理。项目公开条款、客户检查和假设控件当前未写入项目文件。

## 两份 Schema 的用途

- [project-0.8.schema.json](../schemas/project-0.8.schema.json)：只接受保存格式 0.8。
- [project-import-0.1-0.8.schema.json](../schemas/project-import-0.1-0.8.schema.json)：接受应用支持的旧容器版本，用于导入前结构检查。

两者使用 JSON Schema Draft-07。`$id` 是稳定 URN 标识，不是需要联网下载的地址；工具可直接导出本地 Schema，编辑器/独立验证器可手动关联。Schema 本身不是交易项目，不应作为项目打开。标准说明见 [JSON Schema 方言标识](https://json-schema.org/understanding-json-schema/reference/schema)；独立验证使用 [Ajv 官方文档中的 Draft-07 支持](https://ajv.js.org/json-schema.html)。Ajv 8.20.0 仅为锁定的开发依赖，不加入前端运行路径。

字段、可选项、枚举、数组与条件对象由现有运行时校验定义同时生成 Schema，日常维护不手写另一套字段清单。导出含必要字段、类型、COST_ITEMS 的 ids、不同比较基准的所需字段，以及运输/保险/逐术语报价和来源结构；术语字典仅允许 11 术语键。未知扩展属性默认保留；字段字典（如汇率表）的所有值仍须符合规定类型。

## 必须区分的检查层

| 检查层 | 检查内容 | 通过后表示什么 |
|---|---|---|
| JSON 解析 | 标准 JSON、顶层对象、版本 | 可以识别文件；未知版本明确拒绝 |
| Schema / 运行时字段结构 | 必需字段、类型、枚举、可选/可空对象、条件字段 | 可以保留及继续编辑这份草稿 |
| 应用跨项检查 | 不同费用对象的 cost_id 唯一、费用ID非空且不用保留名称、适用术语不重复 | 费用能被安全引用；不是业务确认 |
| 引擎及业务核对 | 数值/日期/汇率、计费依赖与重复计入、税务范围、来源、报价/运输/保险事实、资格 | 按当前支持范围决定可否计算及参与排名 |

Schema 已表达费用ID非空/保留名称和适用术语不重复；不同费用对象间按属性判唯一仍由应用另核，不以 `uniqueItems` 冒充完整解决。两份 Schema 均不证明交易可算、税率适用或业务已获认证。

金额和数量很多字段接受数值文本或有限 JSON 数字，保持既有语义；报价 amount、汇率字典值、保险金额等规定为文本。建议用字符串保存金额/汇率以避免其他程序的二进制浮点转换。空文本、尚未填完或业务上无效的数值/日期可以存为草稿；Schema 不把 `""` 改成 0、不自动设置日期、税率或资格。JSON 本身不表达 NaN/Infinity。日期保留为文本，是否有效由引擎/来源核对负责。

## 可复建与离线使用

`npm run build:catalog` 从源码生成 `schemas/` 和 `templates/`；固定模板时间戳使文件可复建，不是某笔交易的业务日期。CI 两系统重新生成目录并严格比较提交文件，不允许 Schema 或模板静默漂移。开发者测试用严格 Ajv 以及独立坏输入、版本、空值、扩展保留和金额回归对照运行时解析器。

客户端下载模板/Schema 只生成新的独立文件，不读取或替换当前交易，也不更改客户检查、项目文件名、来源确认或保存状态。需要导入模板时先保存当前项目，再通过“打开项目”选择模板。


## 独立内部付款计划（1.0/1.1/1.2）

付款计划不是项目0.8容器，须单独保存。新计划kind为INTERNAL_SETTLEMENT_PLAN、version为1.1，funding对象必需；状态、性质、主体、年基数为明确枚举，本金、币种、日期、年利率百分数及依据为文本，允许保存未完成草稿。1.0无funding语义，读取及保存保持旧版本；显式启用才升级，字段为空且待确认。旧1.0重名funding扩展不自动解释，未来版本或坏结构不替换已有计划；未知其他扩展保留。内部HTML/Excel只是快照，不能当付款JSON导入。详见[资金占用及兼容验收](funding-validation.md)。

付款1.2通过显式启用变动本金创建，新增必需funding.balance_model及events。1.1仍为新建恒定本金的默认版本，旧文件不会自动升级；旧1.1重名扩展保持未知原文，升级拒绝覆盖。事件金额为文本，结构接受未完成草稿，业务计算另查日期顺序、范围、同币种、依据及非负余额。切换模型保留事件且重新确认范围。详见[本金事件验收](funding-ledger-validation.md)。

## 内部恢复快照（1.0）

kind=INTERNAL_RECOVERY_SNAPSHOT、version=1.0包含异常阶段、原始项目、原始汇率编辑行、付款/资金计划、本页假设和客户输入以及浏览器草稿原文。它不属于项目或付款格式。正常页面提供5 MiB以内本地只读结构检查和人工复原指引，区分字段缺失、null、损坏及不支持版本；不自动导入、合并汇率、迁移、提取局部文件或认证业务有效性。原文件是人工复原依据，不以检查解析结果保证原始数值精度。详见[只读检查与复原验收](recovery-review-validation.md)。

## 配套合成本金案例

工具提供独立下载的合成项目0.8、付款1.2、手算核对记录1.0和无脚本HTML说明。记录kind=SYNTHETIC_FUNDING_CHECK_RECORD，不属于项目/付款/恢复格式；HTML/记录不能导入。四文件从固定工厂生成，不读取当前交易。先保存自己的两份JSON，再打开配对案例，绑定错误不直接重绑定。详见[案例与导出指引](funding-example-validation.md)。


## 付款1.3：显式利率事件

先启用1.2，再单独升级1.3；新增必需funding.rate_model（CONSTANT/EVENTS）与rate_events数组（最多100条），每条id/date/annual_rate/reference均为文本。利率是新年利率绝对百分数，业务就绪另查日界、严格日期顺序与来源。升级保留输入、状态归待确认；旧1.2同名未知扩展仍保留、不解释，升级时拒绝覆盖。新建仍1.1，旧文件不静默升级；未来1.4拒绝导入。项目0.8和四份原合成资源保持。见[利率验收](funding-rates-validation.md)。


## 付款1.4：显式金额舍入假设

从1.3单独启用；funding.rounding必需对象，包含status（UNCONFIRMED/NOT_APPLIED/APPLIED）、scope（UNCONFIRMED/TOTAL/INTERVALS）、mode（UNCONFIRMED/HALF_UP/HALF_EVEN/DOWN）、文本unit/reference及布尔intervals_confirmed。允许保存未完成草稿；应用时查正步长/来源，逐区间须明确边界确认。升级保留输入且不填单位或默认方式，旧1.3同名扩展原文保留且升级拒绝覆盖。新建仍1.1，旧格式不自动升级，未来1.5拒绝。原cost保持、舍入审计单独输出，见[验收](funding-rounding-validation.md)。

## 第二十六轮补充：舍入例题文件

新增synthetic-rounding-example配套项目0.8与付款1.4，绑定独立例题名称；不升级现有文件或新建付款默认1.1。SYNTHETIC_ROUNDING_CHECK_RECORD记录1.0是固定手算答案，非项目/付款容器，禁止导入。独立HTML仅作说明；旧本金案例四资源与两份Schema保持原字节。细节见[验收](rounding-example-validation.md)。

## 第二十七轮补充：拟议期间格式尚未启用

[明确期间设计](funding-period-design.md)中的1.5及funding.period_schedule为后续方案，当前付款解析仍最高1.4，未来版本仍拒绝。docs/cases/funding-period-design.json是FUNDING_PERIOD_DESIGN_FIXTURES 1.0设计容器，不能作为项目、付款或恢复文件导入；不修改项目0.8或现有Schema/模板。

## 第二十八轮补充：独立模块不升级文件

领域的FundingPeriodSchedule/FundingPeriodRounding仅为独立函数参数，非当前项目或付款字段。归集模块不读取旧period_schedule扩展；1.0–1.4另存保持原文，1.5及1.4的新scope仍拒绝，Schema/模板不变。[验收](funding-periods-validation.md)。后续须将UI/兼容/恢复/导出同轮贯通才启用1.5。

## 第二十九轮：显式付款1.5

[明确期间接入](funding-period-integration-validation.md)从1.4独立启用1.5，保留未知扩展，funding.period_schedule重名拒绝覆盖；新建仍1.1。新期间字段结构参见[设计](funding-period-design.md)，1.5舍入scope新增PERIODS，旧版原文保存不解释新扩展。1.5保存未完成结构合法草稿，完整覆盖/依据/确认在计算时另查；未来1.6拒绝。项目0.8、恢复1.0及两份项目Schema不变，恢复检查支持1.5且不导入。

## 第三十轮：期间例题四资源

新增synthetic-period-example项目0.8与付款1.5，名称和绑定独立；不升级新建付款或已有文件。SYNTHETIC_PERIOD_CHECK_RECORD 1.0是固定手算记录，不可导入为项目/付款；HTML是无脚本离线说明。例题就绪/应用/确认仅为固定合成输入，不是用户银行合同认证。两份Schema、旧项目模板和八份旧配套资源保持原字节。见[验收](period-example-validation.md)。

## 第三十一轮：独立关联API不升级文件

TransportCostLinkInput只是独立函数参数，审计输出0.1不是项目/付款容器。项目仍0.8、付款1.5、恢复1.0；不解释旧transport_cost_links同名扩展，0.9尚未启用。后续拟在term_scenarios中接入0.9字段，须显式升级/重名保护、Schema、文件及恢复同轮验收；见[接入设计](transport-cost-links-design.md)。

## 第三十二轮：显式项目0.9已启用

0.8新建/模板保持，单独启用后克隆为0.9；term_scenarios[term].transport_cost_links承载目标、关联及可选overlap_resolutions。旧同名扩展不激活且阻断升级，0.9保存不降级，未来1.0拒绝。旧两份Schema原字节保持，新增0.9 Schema可离线下载；恢复1.0识别新结构。候选核对须有原包含关系或不同计费内容说明/来源，保持原候选和金额。见[验收](transport-links-integration-validation.md)。

## 第三十七轮：独立配对容器1.0与映射0.1

INTERNAL_CONTAINER_COST_PAIR 1.0收纳项目0.8/0.9、账单1.0、提案选择0.1及稳定映射/删除记录；独立Schema和完整快照/跨ID检查，修订与UTF-8 10MiB范围保护。项目、账单和付款不能互相误读，旧同名扩展保留，不自动升级项目或执行费用写入。尚无运行工具打开/另存及恢复入口，见[设计](container-cost-pair-design.md)与[验收](container-cost-pair-validation.md)。

## 第三十八轮：配对交接入口及可选恢复资料

配对面板使用现有1.0完整打开/另存，项目0.8/0.9和账单1.0不升级。配对快照独立存储，不自动覆盖其他草稿；原簿未编辑时用可核验汇率行键恢复，未完成/重复FX编辑行不可静默转存。异常备份1.0新增可选container_cost_pair及container_cost_pair_draft_text两部分，旧6/8部分保持；新备份10部分，5MiB只读检查上限保持。完整配对可能10MiB，大恢复文件人工核对；不作为项目打开。见[验证](container-cost-pair-ui-validation.md)。

## 第三十九轮：独立编辑草稿0.1

INTERNAL_CONTAINER_COST_EDITOR 0.1仅是浏览器未提交表单：绑定pair_id/revision/pair_key/line_id，original保留完整原选择或null，fields为严格白名单的字符串。字段可以空白，不冒充CostItem；构建完整选择时再次验证项目/账单/选择并沿用配对1.0。独立浏览器键不自动提交，不是项目字段或可导入项目/配对的文件，五份Schema和旧模板保持。异常备份1.0可选container_cost_editor及container_cost_editor_draft_text，普通仍10部分，有两项时12部分；旧6/8/10兼容，5MiB只读上限保持，不自动恢复。见[设计](container-cost-editor-design.md)与[验证](container-cost-editor-validation.md)。

## 第四十轮：新业务副本沿用配对1.0

明确生成独立候选并另存new-business-container-cost-pair.json，仍为INTERNAL_CONTAINER_COST_PAIR 1.0；打开与原配对共用严格校验。新身份/修订及已知引用重建，项目内费用/汇率/段ID局部保留，0.8扩展不解释；五份Schema/旧模板不变。候选不自动保存浏览器或安装，关闭前须另存；异常备份1.0新增可选container_business_copy（完整配对），普通10部分、有候选11部分，与编辑两部分并存可13部分；旧6/8/10/12兼容、5MiB只读上限保持，不自动导入。见[复制设计](container-business-copy-design.md)与[验收](container-business-copy-validation.md)。


## 第四十一轮：核对格式仍为提案

拟议配对1.1/review_plan 0.1尚未启用，不增加活动字段或Schema。当前配对1.0继续严格拒绝未知活动字段及未来版本；项目0.8/0.9旧同名扩展不激活。未来升级须拒绝覆盖同名扩展，已知核对语义随业务复制清除；下一轮先交付不入文件的只读模块。见[设计](container-cost-review-design.md)。
