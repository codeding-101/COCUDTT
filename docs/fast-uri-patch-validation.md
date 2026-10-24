# fast-uri 开发依赖最小安全补丁验收

2026-10-24，第九十五轮。发布前的 `npm audit --audit-level=moderate` 报告一项中风险依赖告警，涉及同一 `fast-uri` 包的四份公告。保持原审计门槛，先修补再发布。

## 变更与依据

`fast-uri` 是开发依赖 Ajv 8.20.0 的传递依赖，供 Schema 测试使用；不是运行工具的应用依赖。锁文件只将这一包从 3.1.8 更新至 3.1.9，版本、官方 tarball 地址与完整性摘要一起更新。`package.json`、其他锁定包、正式业务源码、Schema/模板及财税逻辑保持。

官方公告均列出 3.1.9 为 3.x 修复版本：[百分号编码的 scheme](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)、[相对路径等价](https://github.com/advisories/GHSA-xhq7-xmqj-769h)、[主机规范化](https://github.com/advisories/GHSA-wjr9-j795-jxcr)、[suffix 引用首段冒号](https://github.com/advisories/GHSA-333x-w4r6-6crp)。这说明包的修复范围，不表示本项目已发生利用。

## 验证与证据边界

- 补丁前锁文件 Git blob：`e8f4fefd577d80ff763528598f80bc9dbb3358ea`；补丁后：`7629862d23bbd3f58c1069ddf8bb7ac66c1c6525`。门禁从当前锁文件逆替换这三项，再核对补丁前整份 blob，保证没有顺带更新其他包。
- 本轮完整138文件4872项测试、69个实际浏览器对照与1/4/8预算阶段在补丁后环境重新运行；补丁前结果单独保留，不将旧记录的依赖指纹改成新值。
- 类型、离线构建、Schema/模板目录、原证据和新增映射门禁重新检查。实际在线审计恢复0项告警；CI继续使用 `npm ci` 与原中风险门槛。
- 离线工具原始字节仍为4,083,172，Git blob仍为 `3d1ab6e3413840b44e80de577956b0364343952c`。原46套完整业务浏览器流程继续标为同字节历史证据，本轮没有重新运行这46套流程。

为保留旧报告，历史门禁只允许明确的旧锁文件指纹及相关证据辅助文件通过本轮完整指纹记录限定。旧报告原字节、原断言、原费用/回执保护和未知利润口径保持；这不是跳过旧检查，也不提供来源采用或确认权限。详见[本轮映射验收](fee-layered-source-mapping-validation.md)和[机器记录](cases/fee-layered-source-mapping.json)。
