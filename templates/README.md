# 项目模板目录

所有模板均为 0.8 标准 JSON。打开前先保存当前项目。工具内“项目模板与文件格式”可离线下载同一文件；下载不替换当前交易。

| 文件 | 用途 | 需注意 |
|---|---|---|
| [china-import-blank.json](china-import-blank.json) | 中国进口空白录入 | 商品、金额、日期、汇率、税率、制度及资格待填写/确认 |
| [china-import-container-checklist.json](china-import-container-checklist.json) | 集装箱费用核对入口 | 六个待填行不代表实际发生；金额空、承担待定，核对已含/重复、收费范围及原因。不适用可删除；分开D&D与联合收费应按原始账单重新选择 |
| [china-import-actual-quotes.json](china-import-actual-quotes.json) | 实际报价比较 | 各术语报价均缺失，不回退公共模拟价；地点、有效期、来源、运输及保险待录入 |
| [china-import-synthetic-example.json](china-import-synthetic-example.json) | 合成公式演示 | 虚构数值，来源标为EXAMPLE，不作为真实税率、汇率、原产地资格或成交数据 |

币种、运输方式和初始术语是可修改的录入起点，不代表实际合同事实；空金额不能当作零费用。没有带HS税率的商品模板，避免未经核实的商品归类/税率成为默认业务事实。客户公开字段和预览检查仍不写入项目JSON。

[catalog.json](catalog.json) 为目录元数据1.0；固定生成时间仅用于可复建。运行 `npm run build:catalog` 更新，字段修改同步通过 Schema/解析器和保存往返测试，CI 核对文件与源码一致。

参见 [格式边界](../docs/project-format.md) 和 [旧项目迁移](../docs/project-migration.md)。真实手机及专业复核按用户安排暂缓；模板/合成测试不等于真实业务验收。

## 明确期间配套合成例

另有[配套项目](synthetic-period-example.project.json)（项目0.8）、[配套付款](synthetic-period-example.plan.json)（付款1.5）、[固定手算记录](synthetic-period-example.check.json)和[无脚本离线说明](synthetic-period-example.guide.html)。先保存自己的项目及付款，再依序打开配套项目/付款，不用重绑定掩盖错配；记录/说明不可导入。三计算段、两归集期及四片交集分别核对，全部为合成内部应计假设，不代表银行结息。旧八份本金/舍入资源保持。


## 精度选择独立文件1.0（开发API）

[空精度记录](fee-precision-selection-empty.json)与[算术示例](fee-precision-selection-synthetic-example.json)均绑定固定合成配对和成分附件；空文件只是records为空，不是空白真实业务。EXAMPLE来源、合成13%比例和汇率7不能当作实际税率、汇率或合同。1.0050001 USD保留精度待办，无政策回执、不应用费用；专用文件API支持，当前工具打开项目/配对入口不能混用。见[文件验收](../docs/fee-precision-selection-file-validation.md)和[离线Schema](../schemas/fee-precision-selection-1.0.schema.json)。
