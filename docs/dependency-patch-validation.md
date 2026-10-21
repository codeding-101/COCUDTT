# Vite 开发依赖安全补丁验收

2026-10-21，第八十六轮发布前审计发现锁定的Vite 7.3.6被标记为1项高危依赖风险。核对官方公告后，将开发依赖固定为最小修复版本7.3.7，更新锁文件；没有执行跨主版本升级或批量依赖更新。

## 依据与范围

官方公告列出受影响Vite 7.0.0–7.3.6、修复版本7.3.7；对应launch-editor的修复版本为2.14.2。相关问题涉及编辑器参数、Windows命令转义及路径存在性检查，需对照各公告的适用条件，不能据此推断所有运行环境受到同样影响。

- [Windows百分号转义：GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv)
- [编辑器参数：GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw)
- [Windows路径检查绕过：GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)
- [Vite 7.3.7官方发布](https://github.com/vitejs/vite/releases/tag/v7.3.7)

公告于2026-10-06发布、2026-10-20更新，本轮于2026-10-21重新审计时发现。Vite是本项目开发/构建工具；用户双击的离线HTML不运行Vite开发服务。本轮没有发现或声称发生过利用或交易数据泄露。

## 已执行的最小改动与验证

- `package.json`中的Vite固定为`7.3.7`，开发侧复现环境不再使用该项范围版本；其余依赖版本保持。
- 锁文件除根开发版本声明外，只变更`node_modules/vite`条目；npm安装结果为changed 1 package，没有新增依赖。
- npm审计恢复为0项漏洞。结论对应本轮锁文件和审计日期，不是未来无漏洞保证。
- 使用7.3.7重新执行类型检查及单文件构建，生成的离线工具仍为4,073,385字节，Git blob仍是`c5c59c2c98930c4d1a2bd9a7a56b80967498389b`；与上一公开版本逐字节一致。
- 补丁环境重新执行完整120文件4445项回归，以及原文共享1/4/8检查；共享记录另列Vite版本、package与锁文件指纹。结果和远程双平台CI按[本轮验收](fee-text-sharing-validation.md)及PR核对。

全部运行`src/`、财税算法、旧文件格式、Schema、模板与客户导出保持。该补丁不会把共享原型接入运行工具，也不解除4/8笔合成资料的原容量限制。
