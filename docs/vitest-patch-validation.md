# Vitest5.0.3测试依赖补丁验收

2026-10-22，第九十轮发布检查中追加。初次PR双平台4614项均通过，但实际日志中有两项中风险依赖告警。原`npm audit --audit-level=high`成功退出不能解释为零漏洞；本轮纠正该记录，并将CI门槛改为`moderate`。

## 依据与最小变更

官方公告[GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)说明手动mock注册的代码注入问题；[GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)说明Windows反斜杠目录穿越问题，两者均列5.0.3为修复版本。涉及可接触相关开发服务的客户端与mocker插件，不据此推定正式离线工具发生过泄露或利用。

`vitest`从5.0.0最小升级并固定5.0.3，Node24满足发布包要求。lock中实际更新五个包：vitest、@vitest/mocker、@vitest/spy、magic-string和why-is-node-running；移除后者不再使用的siginfo、stackback，无新增包。根应用依赖、其他开发依赖声明及Vite7.3.7保持；不运行通用`npm audit fix`或扩大应用依赖升级。

## 实际验证与历史证据

- 补丁后`npm audit --json`实际记录info/low/moderate/high/critical/total均0；不能只凭命令退出码写零漏洞。
- 完整128文件/4614项在补丁环境复跑；原断言、原超时和两个worker保持，CI与本地最终结果分别核对。
- 旧[42场景原报告](cases/fee-source-compatibility.json)完整字节及源提交保持。另存[补丁环境42场景](cases/fee-source-compatibility-patch.json)，逐场景事实完全相同，12个源指纹仅lock不同；0.1仍有四例，不改写旧证据。
- 新[0.2的69场景](cases/fee-source-semantic-budget.json)亦在补丁环境完整重跑；52份完整捕获相同，四例关闭；[CI检查器](../tools/check-fee-source-compatibility.mjs)核对旧报告固定哈希及新资格记录，仍执行原42场景检查。
- 正常构建和介绍页复验以补丁后结果为准；只有离线原始字节核对仍相同，才继续使用同产物的历史完整原生流程证据。不把本轮捕获矩阵当46套完整应用流程重跑。

本补丁只修测试工具链告警；来源预算原型、正式4/8容量和业务规则的状态见[本轮验收](fee-semantic-budget-validation.md)。双平台CI和发布依据最终具体提交及实际日志核对，不沿用初次PR的绿色状态作为补丁后证明。
