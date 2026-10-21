# 来源适配兼容性验收

2026-10-21，第八十九轮。新增37项，完整126文件/4569项通过；本轮只交付开发诊断、兼容矩阵及CI接入门槛。正式工具保持原捕获和原字节。

## 自动化证据

| 证据 | 范围 |
|---|---|
| [诊断单测](../tests/fee-source-compatibility.test.ts) | 四阶段区分、完整差异不自动替换、旧捕获异常/未执行、错误隐私、异常访问器、所有者变更/ABA、普通JSON保留与无确认资格 |
| [真实边界单测](../tests/fee-source-compatibility-boundary.test.ts) | 根相对深度31/32/33，树节点299999/300000/300001，实际128MiB ASCII和中文JSON字节在上限前/正好/后一字节；原解析含空白正好128MiB、UTF8超限、转义重复键及孤立代理码元 |
| [42场景原生浏览器记录](cases/fee-source-compatibility.json) | 未改动真实app捕获、原保留解析、新帧和重建分开；完整JSON逐字比较，含九个持有者的未知扩展 |
| [CI核对](../tools/check-fee-source-compatibility.mjs) | 浏览器记录与12个源指纹匹配、正反例和只读事实、正式app和产物不含新入口/测试桥接 |

字节单测实际创建并验证128MiB边界，没有以较小模拟预算代替。中文场景同时确认JavaScript字符数小于上限而UTF8字节能超限。字节/语法通过不证明符合项目文件格式或业务规则。

测试默认并发限制为2个worker，避免大内存边界用例与原完整事务同时争用资源；保留原测试断言和既有超时。首轮未限制并发的全量执行有两条原事务用例超时，不能记为通过；通过记录以限制并发后的完整复跑为准。

浏览器记录的21场景捕获相等，4个普通JSON反例为`depth_29`、`depth_30`、`nodes_frame_over`、`nodes_retained_at`；详见[设计与节点数](fee-source-compatibility-design.md)。每场景比较期项目/回执/客户确认和所有者保持，存储两端合计20读、0写；设置/还原和旧路径访问器的受控计数在记录中单列。完整交易就绪始终`NOT_TESTED`，未执行费用应用。

## 复现

在仓库根目录，Node24及锁定依赖安装后：

```text
npm test
npm run check:fee-source-compatibility
npm run typecheck
npm run build:single
```

原生浏览器另用独立临时配置启动Chromium或Edge远程调试端口。在该配置中只运行合成数据，设置`FEE_SOURCE_COMPATIBILITY_DEDICATED=1`、`BROWSER_CHECK_PORT`和`BROWSER_CHECK_OUTPUT`，执行`npm run check:fee-source-compatibility:browser`。驱动只建立并关闭自己的页签，结束时关闭本轮专用浏览器。服务器固定本机4193端口，HMR/文件监听关闭，桥接不写入`app.ts`。

## 发布与范围

原财税/费用归属、FX、文件格式、Schema/模板、运行源代码和依赖均保持。离线工具原始Git blob继续`c5c59c2c98930c4d1a2bd9a7a56b80967498389b`，4073385字节；不含`__feeSourceCompatibility89`。README、能力矩阵、阶段计划及介绍页说明本次发现和接入条件。PR/main双平台CI、介绍页布局和公网原始文件核验作为独立发布证据留存于本轮记录。

前46套完整原生浏览器流程属于第八十四轮同字节产物的历史证据，本轮未重跑；本轮42场景专测捕获兼容性。128MiB保护、正式4/8笔容量限制保持，未声明提速或峰值内存变化。本轮没有重复1/4/8性能测量，因为运行路径与产物未改变。真实手机、真实单据及专业人工复核仍暂缓。

接入计划因普通JSON反例调整：先做语义预算/帧布局方案并关闭四例，再进行只读接入与完整流程复验。保留原入口是当前保护方式，诊断JSON不实现自动回退，也不提供导入、恢复或业务确认能力。
