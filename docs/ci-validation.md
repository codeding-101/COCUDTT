# GitHub CI验收与依赖修复

日期：2026-10-11；[草稿PR #1](https://github.com/codeding-101/COCUDTT/pull/1)，功能分支`codex/china-import-buyer-workflow`。本次提交未合并或发布Pages。

## 远程工程验证

GitHub重连后写入成功，改动基于main提交`cde070bd3b573f5bc656cecd94c5c77de09564f3`，保留此前README删除。首次提交`814862f00f7375e6ff1b9f4c67e0b54bb7770348`的65个改动文件与本地规范化文本逐一比较Git blob SHA，全部一致；其余51个文件保留原blob，包括截图资产。

[首轮工作流](https://github.com/codeding-101/COCUDTT/actions/runs/38122571368)在Ubuntu及Windows均通过：锁定依赖安装、28个文件449项测试、界面静态审查、类型检查、离线构建及`git diff --exit-code -- trade-cost-engine.html`。两个系统均上传了离线HTML和dist构建，保留14天。运行的是GitHub为PR生成的临时合并提交，不代表已将PR合入main。

## 实际发现与修复

首轮安装日志同时报告一个高严重性依赖漏洞。新增`npm audit --audit-level=high`后，[第二轮工作流](https://github.com/codeding-101/COCUDTT/actions/runs/38122782012)明确阻断于`source-map-js 1.2.1`的GHSA-68fv-2mgg-jv7q。该依赖由构建工具PostCSS引入。

[官方公告](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)指定修复版本1.2.2。已按npm官方注册表的版本、tarball地址和SHA512完整性更新锁文件；范围仅该补丁版本，以及让锁文件根版本与既有package.json的1.0.0一致。未升级Vite、Vitest或TypeScript主版本。

修复后本地449项测试、静态审查、类型检查及离线构建再次通过。新HTML的SHA256仍为`14ea298d0ba678aae6e3a986be1d0dbfb02c8c08f200803a11c70ab04c06ad24`，与已经过Edge验证的交付文件字节完全相同。

本机npm在线审查受证书链问题影响，未将该错误当成审查通过；补丁包通过保持证书校验的系统HTTP客户端下载，并验证官方SHA512后离线安装。依赖审查最终依据GitHub运行中的npm结果，保留真实问题和修复记录。

## 每次PR的完成标准

两个系统都需通过依赖审查、449项回归、静态审查、类型检查、构建与交付文件一致性检查，且检查对应当前PR head。最终运行链接与结果记录在[PR说明](https://github.com/codeding-101/COCUDTT/pull/1)中；早期提交的成功不能替代最新提交的验收。

远程CI未覆盖浏览器、实际下载落盘、真正打印分页、手机硬件或真实业务交易；这些边界仍见[买方流程验收](buyer-workflow-validation.md)。下一步完成审阅及发布复核，再推进方案专属运价与业务试用。
