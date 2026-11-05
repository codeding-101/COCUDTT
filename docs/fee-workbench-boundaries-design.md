# 缓存方法、集合调用与输入缓冲边界

2026-11-01，第115轮，本地只读诊断。以[第114轮观测](fee-workbench-observation-design.md)为基础，补登记方法的缓存引用、指定集合操作及原生输入证据；不更改原应用源码、计算、格式或离线工具。

源码解析产生40个方法入口与43处集合调用，共83处、8组持有者。方法体入口仅在本机Vite响应中插入通知，因此提前缓存的原函数仍会通知，不换函数、对象或接收方。集合覆盖三个全局Set及三个控制器的WeakSet调用；准备原callee后再求值原参数，保留查找顺序、返回、Promise和原错误。字段接收方只登记一次，操作时不额外读取字段getter；接收方不符或未知入口保留未知，不能发行有效检查。

输入适配器监听原root的六种原生输入事件，并用MutationObserver和检查时同步扫描覆盖input/select/textarea。事件和结构变化推进单调代次；内容改回也不复用旧检查。原值、勾选、多选、badInput和File对象身份只保留在诊断内存，不进入报告；不读取文件内容。变动的控件移出页面后仍保留证据，读失败不清掉已有变动。相对于首次观测的差异不证明输入尚未提交，也不证明已保存；重绘后的变动控件可能继续列为待核对，不自动清除。

关闭诊断移除自己的六个root监听器、MutationObserver、面板监听器及保留的输入/持有者引用；原应用监听器、任务和URL保留。复用原114实例适配器撤销时恢复当前值和原描述符，不回滚用户操作。

本轮短时诊断在停止前保留已见控件的身份和证据；未验证长期连续重绘的内存增长或独立诊断容量。正式接入前须设计已核对证据的退役与保留上限，超限明确退出观测，不能静默删除变动输入。本轮不提供内存或容量改善结论。

范围限制：任意外部嵌套修改、反射、无事件的脚本属性ABA、关闭的Shadow DOM、未登记资源及所有缓冲尚未覆盖。once、AbortSignal自动移除、stopImmediatePropagation和重复注册仍采用原生回调与options，不靠包装回调猜测移除；无法证明的生命周期继续未知。**初始保存证据、完整新鲜性、应用资源解绑及完整工作台切换均未核实或实现。**安静计数、合成测试和本轮报告均不授权导入、报价、费用应用或切换。

见[实现](../tools/fee-workbench-boundaries.ts)、[输入证据](../tools/fee-workbench-dom-buffers.ts)、[源码计划](../tools/fee-workbench-boundaries-inventory.mjs)、[测试](../tests/fee-workbench-boundaries.test.ts)、[验收](fee-workbench-boundaries-validation.md)与[后续阶段](development-stages.md)。
