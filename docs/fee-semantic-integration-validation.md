# 只读语义捕获接入验收

2026-10-22，第九十一轮。正式工作台开始使用语义根捕获，业务公式、费用归属、文件格式、确认提交和原始预算保持。

| 证据 | 本轮范围 |
|---|---|
| [接入设计](fee-semantic-integration-design.md)与[生产模块](../src/ui/fee-workbench-semantic-capture.ts) | 显式真实生产者、原保留根和完整捕获预算；没有新应用权限 |
| [生产边界回归](../tests/fee-semantic-integration.test.ts)及[实际复合字节回归](../tests/fee-semantic-integration-size.test.ts) | 新增45项；四反例、描述符、ABA、无候选权限及双层转义/中文/emoji的128 MiB前/正好/后一字节 |
| [新页面捕获矩阵](cases/fee-semantic-integration.json) | 42兼容状态、27操作状态；实际 app 连接与独立历史捕获对照，52份完整捕获一致，四反例仍关闭 |
| [完整原生回归](cases/fee-semantic-integration-native.json) | 全部46套重新运行，覆盖基础概念、税费、报价、客户与内部导出、十组候选、明确提交、恢复与四种模拟宽度 |
| [CI接入检查](../tools/check-fee-semantic-integration.mjs) | 当前源指纹、历史证据资格连接、生产桥接隔离、完整流程与原子提交关键断言 |

完整130文件4659项单元测试；原45项原型回归保留，本轮45项直接检查生产模块。历史[0.1证据](fee-source-compatibility-validation.md)和[0.2证据](fee-semantic-budget-validation.md)没有改写成当前接入结果。

原生流程包括确认前 flush 输入、最新代次重准备、一次根替换、陈旧按钮不重复计费、项目费用与回执同时出现、保留原来源/FX/文件证据、撤销旧客户确认、提交后显示失败备份及重试不重用旧候选。内部备份不是客户报价；正式 JSON 另存、客户 HTML/Excel/PDF 和资料隔离分别检验。

浏览器验证使用本轮专用 Edge 隐藏配置，运行原46套驱动；原文件输入与保存故障检查中的 API 替身范围仍按各驱动声明，实际下载、Web Locks、第二页签与视口由原浏览器流程验证。四种宽度为1440、768、390、320；模拟宽度不代表真实手机验收。

公开验证记录移除本机下载目录等环境路径，保留全部检查结果、布局、来源指纹和合成交易状态。原始报告仅保存在本地；公开报告哈希针对脱敏后的 JSON。CI 拒绝公开记录中的本机绝对路径。

首次单元启动被沙箱 realpath 限制拒绝；在常规执行权限下完整重跑。浏览器首次运行缺少原专业套件要求的4353模块预览服务，未作为成功证据；补齐预览环境后从头执行全部流程。依赖审计读取实际 JSON 统计，不根据命令成功推定零告警。

## 复现

```text
npm test
npm run typecheck
npm run check:fee-source-compatibility
npm run check:fee-semantic-budget
npm run check:fee-semantic-integration
npm run build:single
```

原生捕获矩阵需设置 `FEE_SEMANTIC_INTEGRATION_DEDICATED=1`、`BROWSER_CHECK_PORT` 和 `BROWSER_CHECK_OUTPUT`，再运行 `npm run check:fee-semantic-integration:browser`。本机4196测试服务只在内存追加桥接。完整流程另执行 `node tools/run-browser-regression.mjs`；专用浏览器须已有普通页签，并启动 `vite preview --host 127.0.0.1 --port 4353 --strictPort`，供原专业套件验证模块构建。

本轮不宣称全输入等价、提速、峰值内存下降或正式4/8笔容量提升。容量同条件复测安排在下一轮。真实单据、真实手机与专业人工复核仍未完成。双平台 CI、公开页面最终结果以发布时核对的具体提交和产物为准。
