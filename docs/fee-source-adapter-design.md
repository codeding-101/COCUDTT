# 真实页面来源字段与独立适配

2026-10-21，第八十八轮。承接[生产者视图](fee-source-view-design.md)。本轮实现浏览器可用的[独立适配模块](../src/ui/fee-workbench-source-adapter.ts)，通过真实页面的原捕获函数做对照；`app.ts`仍调用原函数，正式费用入口、文件格式和预算保持。

## 适配协议

`captureFeeWorkbenchSourceFrame(owner, readers)`从受信任同步生产者取得普通数据，返回`INTERNAL_FEE_WORKBENCH_SOURCE_FRAME`、版本`0.1`的冻结帧。帧包含十组`producers`、显式`pending`与`storage`；固定`financial_writes:0`、`import_authority:false`、`confirmation_authority:false`。它不是正式项目文件、恢复文件或可执行回调描述。

读取顺序为账单、配对、成分、精度、封套及三个工作区，再读取所需工作流、已初始化项目、控件投影与存储。每次读取和最终严格复制之后检查[原所有者](../src/ui/workbench-state.ts)检查点；期间变更或A→B→A使整份捕获失败，不返回部分帧。回调必须由应用明确配置；发生在回调自身的外部写入不由适配器回滚，旧式嵌套修改仍需`touch()`。

返回帧只保存数据，不保存签发检查点或之后的有效性资格。`projectFeeSourceFrameToLegacy(frame)`可从该数据重建原`RuntimeFeeWorkbenchCapture`，继续原完整捕获校验；转换结果不是已批准候选。原预览、最新来源比较、十组准备、明确确认和原子应用均仍由原路径负责。

## 原捕获九个根字段的覆盖表

依据是[真实页面捕获](../src/ui/app.ts)的`captureCurrentFeeWorkbench()`，不从`retained_json`反向猜测结构。

| 原字段 | 适配来源与明确规则 |
|---|---|
| `scope` | 重建原固定标记，不把内部帧kind当正式捕获 |
| `envelope_json` | 封套公开捕获的`current.raw_json`，无当前资料保持null |
| `sources`五项 | 项目使用原序列化及当前FX选择；账单/配对使用原序列化；成分/精度保持原两空格缩进及末尾换行 |
| `fx`三项 | 原始汇率编辑行、保留行key和保留books独立序列化；未初始化时行是空数组，保留依据仍按原值处理 |
| `files`六项 | 项目及五控制器各自的name、saved_raw、saved_at；不按相同原文合并持有者 |
| `editors`五项 | 四组完整未提交编辑；pendingCalculation或仍有控件时保留pending输入，未知不填零 |
| `activity`六项 | 项目读取token与epoch相等；账单/配对读取；成分/精度读取、修改、保存、候选、恢复、工作区待确认/导出；恢复阶段或恢复复核繁忙 |
| `retained_json`二十项 | 下表逐项重建，保留原键顺序、缩进和换行 |
| `blockers` | 原顺序：INVALID_FX_OR_PROJECT、ACTIVE_ENVELOPE、ACTIVE_FILE_WRITE；各自独立，不以一个busy替代 |

## 二十项保留数据

| 原保留字段 | 帧中的来源 |
|---|---|
| `project_raw` | 原项目对象；不借用重新计算的FX来源替代它 |
| `project_file` | 项目fileName、savedAt、dirty和fileEvidence.saved_raw是否已知；未初始化时前三项为null，已知标记为false |
| `bill`、`pair` | 原控制器公开`workbenchCapture()`，完整保留其字段及未知JSON扩展 |
| `tax`、`precision`、`envelope` | 各自完整公开捕获，包括读取代次、候选、原文、文件证据和已观察存储 |
| `tax_workspace`、`precision_workspace`、`envelope_workspace` | 原工作区公开捕获，保留待确认及导出/输入状态 |
| `project_read_epoch`、`project_read_token` | 工作流原值，迟到读取不能用相同文本恢复资格 |
| `settlement_epoch`、`settlement_plan` | 工作流原代次及计划值 |
| `sensitivity` | sensitivityControls原值 |
| `customer_fields`、`customer_view`、`customer_reviewed` | 客户输入、版式及原确认状态；捕获不重新确认 |
| `pending_control` | 显式DOM投影，或null；与“仍有控件”标记分开 |
| `storage` | 十个原键，各自raw及available |

## 四个容易遗漏的边界

**FX保留依据。**[原页面`currentProject()`](../src/ui/app.ts)仅在`pairFxLease.row_key===JSON.stringify(fxRows)`时保留整本books及身份/扩展，否则使用[原rowsToBooks](../src/ui/fx-rows.ts)。适配器逐字遵守，同时保留原项目、原始编辑行和旧books。原分组会跳过不完整行；这不证明行已合法或可以提交，原交易预览/FX校验仍负责阻断。项目转换失败时保留原输入，sources.project_json为null并加入原阻断原因，不补造金额或汇率。

**DOM。**真实workflow含boundRoot和editedControl，不能直接展开后交给JSON复制器。`observeFeeSourcePending`只读取原控件投影：tag、id、type、value、dataset、connected。DIV等非表单控件仍使present为true、投影为null；未连接控件、只有pendingCalculation的情况分别保留。这里复刻原投影，未额外保存checked、光标或所有DOM状态；控件仍存在就保留未提交阻断，不能把投影当点击/提交或业务确认。

**存储。**`observeFeeSourceStorage`只要求getItem，按原十键顺序逐个读取。不存在为raw:null/available:true，拒绝访问为raw:null/available:false，空串、损坏JSON、BOM和换行均保持原文；没有解析、写入或删除方法。非原生返回类型拒绝，不把undefined默认为无资料。

**文件证据。**name、saved_raw和saved_at分别保留，原始文件文字不重新格式化。同文不同名仍是两份证据；下载发起不生成保存时间或清除dirty。未初始化不能读取旧app对象来伪造新项目。

## 预算、严格性与接入限制

帧和重建捕获分别经过原严格JSON复制器，继续128 MiB、300000节点、32深度。帧把以前不透明的保留状态放在结构内，包装和真实节点/深度也占预算；因此可能比旧捕获更早拒绝某些深层或复杂输入。访问器、toJSON、DOM节点、Promise、非有限数或非普通JSON数据拒绝，不借原JSON.stringify的隐式转换丢失事实。

本轮证明的是[27个真实浏览器场景](fee-source-adapter-validation.md)中完整JSON一致，包含一次正式合成资料采用；不是任意未来扩展、所有JS对象或全输入等价性证明。重建仍生成原retained_json，没有提高4/8笔生产容量，也未测量提速或峰值内存。

下一步先补帧深度/节点及旧合法输入的兼容矩阵，再分步接入只读捕获，复验预览、候选、恢复和客户隔离；完整回归、浏览器与同条件1/4/8均通过前继续保留原容量限制。
