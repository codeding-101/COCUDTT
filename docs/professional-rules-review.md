# 第七轮：专业规则盘点与已知误导点修正

核对日：2026-10-11。项目文件格式仍为0.6；费用规则实现版本由1.0调整为1.1。首条业务路线仍为中国一般贸易进口、单商品一票。

本轮把已知的错误推断撤掉，建立规则与源码、测试、权威依据的对照，并交付项目介绍入口。结论限定于下列条文和用例，不代表全部现行公告、所有合同例外或真实交易已经审查。合成测试、源码规则复核、专业人员复核、实际报关对照是不同验收状态；后两者尚未完成。

## 已交付的修正

1. **FCA交货条件进入风险计算。** 卖方场所为货物装上买方安排运输工具、装货完成；其他指定地点为货物仍在卖方运输工具上、准备卸货并交由买方指定人员处置。未选择地点时标记“交货地点待确认”，保留金额而排除该方案排名。直接调用`resolveRisk('FCA')`仍保留原粗节点，但必须检查`needs_confirmation`，不能当成确定风险点。已有`facts.delivery_place`存档，不新增文件字段。
2. **FOB变形费用不再凭名称自动转给买方。** LINER下起运港整节点、装船节点，以及UNDER_TACKLE装船节点改为待确认；标准FOB及已录的有限理舱/平舱含费分支继续按现有规则。引擎层支持逐项责任覆盖并保留原因，界面尚未接入合同覆盖录入；选择这些未确定变形可能使相应费用和排名保持待确认。费用覆盖不自动改变标准FOB上船风险；改变交货/风险的补充合同尚未建模。
3. **移除近似退税逾期判定。** 不再用次年4月30日与当前日期推定法定逾期或内销征税。提示分别说明2025及以前业务过渡、2026起规则或日期无法判断，并要求核对实际申报、凭证与收汇。`REBATE_DEADLINE`保留为条件核对编码，退税金额仍是原有假设下测算；中国进口没有该出口退税提示。这不等于完整修正2026年退税金额模型。
4. **修正保险和追偿表述。** 缺保险费项提示未单列、费用可能包含在其他项目，并区分CIF/CIP默认条款；录入保费不认证保额与险别。承运人原因或不可抗力不再直接提示可向承运人索赔，追偿需另核合同、事实及证据。
5. **结果记录规则实现版本。** 输出与内部报告展示`incoterms2020 · 1.1`，这是费用规则的程序实现版本；它不同于Incoterms 2020文本版本、税务配置版本和JSON格式0.6。

## 规则追溯表

“用例吻合”指限定场景内实现与已对照条文/手算一致；“部分实现”表示人工前提或模型缺口仍存在。

| 规则ID | 条文/适用范围 | 实现及回归 | 核对结论与边界 |
|---|---|---|---|
| CN-FX-01 | [征税办法272号令](https://www.mct.gov.cn/preview/whhlyqyzcxxfw/ss/202411/t20241106_956082.html)13/14/19条；2024-12-01施行 | [china-import.ts](../src/engine/tax/china-import.ts)、[dutiable-value.ts](../src/engine/tax/dutiable-value.ts)、[中国进口测试](../tests/china-import.test.ts) | CNY、申报日期、有效期覆盖和分舍入用例吻合；官方汇率发布与临时调整人工核对，特殊申报日期分支未建模 |
| CN-VALUE-01 | [关税法](https://fgk.chinatax.gov.cn/zcfgk/c100009/c5234556/content.html)24–27条；2024-12-01施行 | [dutiable-value.ts](../src/engine/tax/dutiable-value.ts)、[analyze.ts](../src/engine/analyze.ts)、[中国进口测试](../tests/china-import.test.ts) | 部分实现：净价、运保费、显式加计/排除及父项去重；未自动鉴别起卸前后范围、特许权费、买方协助、关联交易和替代估价 |
| CN-TAX-01 | 272号令17/19条；[增值税法](https://fgk.chinatax.gov.cn/zcfgk/c100009/c5237365/content.html)14条，2026-01-01施行 | [import-tax.ts](../src/engine/tax/import-tax.ts)、[中国进口测试](../tests/china-import.test.ts) | 从价/从量/复合关税、从价消费税、VAT递进及逐税种舍入用例吻合；从量/复合消费税、贸易救济和额外税种未建模 |
| CN-LOW-01 | [2024年第17号关税公告](https://gss.mof.gov.cn/gzdt/zhengcefabu/202411/t20241129_3948542.htm)、[财关税2004年7号](https://fgk.chinatax.gov.cn/zcfgk/c102416/c5202868/content.html)第三项 | [import-tax.ts](../src/engine/tax/import-tax.ts)、[中国进口测试](../tests/china-import.test.ts) | 单商品一票，各税种独立、分舍入后低于50元的边界用例通过；不能扩成多商品票逐商品免征 |
| CN-RATE-01 | 关税法11–14条及实际税则/原产地规则 | [import-tax.ts](../src/engine/tax/import-tax.ts)、[decision-readiness.ts](../src/engine/decision-readiness.ts)、[来源测试](../tests/source-readiness.test.ts) | 部分实现：缺所选口径及重复HS阻断，父级/兜底提示、来源/待遇未确认退出排名；不是自动2026税则库，不自动认定优惠资格 |
| CN-VAT-01 | 增值税法16条；[实施条例826号令](https://fgk.chinatax.gov.cn/zcfgk/c100010/c5246349/content.html)11/12条，2026-01-01施行 | [decision-readiness.ts](../src/engine/decision-readiness.ts)、[来源测试](../tests/source-readiness.test.ts) | 全额抵扣假设的身份、用途和资料检查；混合用途、部分抵扣及实际缴款书核验未实现。国内销售额换汇规定不能替换海关汇率 |
| INC-FCA-01 | [ICC规则正文FCA A2/A3](https://library.iccwbo.org/content/tfb/BOOKS/BK_0049/BK_0049_04_RulesAny.htm)，Incoterms 2020 | [risk.ts](../src/engine/risk.ts)、[risk.test.ts](../tests/risk.test.ts)、[来源测试](../tests/source-readiness.test.ts) | 本轮补两个地点分支和缺失待确认；粗粒度节点尚不能表示所有交货地点、同节点作业时点及承运人组合 |
| INC-RISK-01 | ICC规则正文CPT/CIP与[FOB/CFR/CIF](https://library.iccwbo.org/content/tfb/BOOKS/BK_0049/BK_0049_05_RulesSea.htm)A2/A3 | [risk.ts](../src/engine/risk.ts)、[概念测试](../tests/incoterm-concepts.test.ts) | C类费用支付终点与风险点分开；多段承运人/指定交货点还待建模，不证明风险贯穿至费用终点 |
| INC-INS-01 | ICC规则正文CIP/CIF A5 | [analyze.ts](../src/engine/analyze.ts)、[费用规则](../src/engine/responsibility/rules-incoterms2020.ts) | 部分实现：CIF默认Clauses(C)、CIP默认(A)及110%合同价格基线为提示；实际保额、币种、区间、保单与另约条款未核验，净货值/完税价不能替代合同价作为保额基线 |
| INC-VARIANT-01 | [ICC出版物引言第78段](https://library.iccwbo.org/content/tfb/BOOKS/BK_0049/BK_0049_03_Introduction.htm)及实际合同 | [费用规则](../src/engine/responsibility/rules-incoterms2020.ts)、[责任测试](../tests/responsibility.test.ts)、[来源测试](../tests/source-readiness.test.ts) | LINER/UNDER_TACKLE有关费用改待确认；引言提示变费用须明确是否改交货/风险，但引言指导不是规则正文或某合同的法律结论 |
| CN-REBATE-DATE-01 | [财政部税务总局2026年第11号](https://szs.mof.gov.cn/zhengcefabu/202601/t20260131_3983038.htm)九（一）4及十；[总局2026年第5号管理办法](https://zhejiang.chinatax.gov.cn/art/2026/2/2/art_8409_84411.html)48/49条；均2026-01-01施行 | [rebate.ts](../src/engine/tax/rebate.ts)、[退税测试](../tests/rebate.test.ts) | 本轮仅修条件提示：不能只凭日期判断申报、收汇、凭证是否合规或是否应征税。新旧业务过渡、36个月、实际申报期等需核对适用条件 |

272号令链接是文旅部政府网站转载的海关文件，其余法规来自财政/税务政府网站；ICC正文与出版物指导分别标识。不复制整套规则全文，也不把教学说明、实现版本或人工点击确认当成权威认定。

## 系统边界盘点

| 边界 | 已有证据 | 待补范围 |
|---|---|---|
| 非法/负税率、100%消费税及非有限数 | 中国进口测试含阻断与接近1的分母案例 | 合法但极大税额的业务合理性提示 |
| 从量税单位缺失/不匹配 | 中国进口测试含阻断；按字段语义检查 | 单位换算、双数量及溢短装 |
| 零金额、负商业费用 | [stress.test.ts](../tests/stress.test.ts)含返还/折让；[tiered.test.ts](../tests/tiered.test.ts)含零计费量 | 退款与冲减的法律计税范围，不能把所有负费用一律拒绝 |
| 零/负商品数量 | 主入口已有数字语法，从量税检查非负 | 真实商品数量的业务约束及从价模式完整验收待补，不等同于阶梯计费量 |
| 极小汇率 | [fx.ts](../src/engine/fx.ts)和[decimal.ts](../src/domain/decimal.ts)按六位小数量化、量化为零拒绝 | 明示可用精度边界；不能宣称所有极端汇率均支持 |
| 费用重复、依赖循环与替代运价冲突 | 费用图/中国进口/方案费用测试 | 更多真实收费口径与含费合同案例 |
| 无效、过期或修改后的来源 | 来源测试含失效与排名排除 | 链接/文件内容真实性依赖人工，不是自动认证 |
| FCA地点、FOB有限费用变形 | 本轮新增回归、覆盖优先级和排名恢复 | 合同覆盖UI、原文证据、具体指定地点与独立风险约定 |
| 退税日期分界与缺失/非法日期 | 本轮覆盖2025/2026、4月前后及长周期；中国进口隔离 | 完整2026退税金额、收汇和凭证模型待独立核验 |

## 项目展示与本轮验证

[独立项目介绍页](../project-introduction.html)可与离线工具放在一起打开；工具内折叠说明无需额外文件。静态构建也包含介绍页，并将其进入工具的链接适配为`index.html`。页面说明目标用户、流程、现有与待开发能力、架构、历史CI证据、AI参与及责任声明，不包含交易资料。

本轮29个测试文件、483项测试通过；类型检查、静态审查及离线/静态站点构建通过。新增17项回归主要验证地点条件、FOB待确认/覆盖、排名和退税错误推断撤除。首提交8d84d9d的[Windows/Linux CI](https://github.com/codeding-101/COCUDTT/actions/runs/38150610347)均通过483项测试、0漏洞依赖审查和源码/HTML一致性检查；后续提交以[本轮草稿PR #4](https://github.com/codeding-101/COCUDTT/pull/4)当前检查为准，保持未合并。

Edge已通过既有来源/文件/运价/报告回归及[本轮浏览器脚本](../tools/professional-review-browser-check.mjs)：FCA地点缺失/两分支/清除、0.6文件真实输入控件往返、报告风险与规则版本、FOB班轮THC待确认及标准分支恢复、说明展开状态、1440px/320px介绍页和320px工具均正常，无页面横向溢出及未处理异常。独立工具按file://、静态构建按本机HTTP分别检查，不能把Vite模块入口当作单文件离线交付；介绍页打印媒体样式可读。保存API使用替身，真实手机、真实落盘和实际打印分页仍待验收。

后续先接入逐方案实际合同报价及有效期、合同覆盖资料/录入和更具体的交货地点，再扩展保险与运输段配置及结果图表。收集真实资料和专业人员复核保持独立待办。此前0.5发布候选仍未合并，本轮不更新公开网站。
