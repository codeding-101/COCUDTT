import{readFileSync,existsSync}from'node:fs';import{resolve,dirname,relative,isAbsolute}from'node:path';
const root=resolve(import.meta.dirname,'..'),files=['docs/capability-evidence-matrix.md','docs/china-import-walkthrough.md','docs/capability-walkthrough-validation.md','docs/fee-tax-components-design.md','docs/fee-tax-components-design-validation.md','docs/fee-tax-components-module-validation.md','docs/fee-tax-attachment-design.md','docs/fee-tax-attachment-design-validation.md','docs/fee-tax-attachment-file-validation.md','docs/fee-tax-attachment-controller-validation.md','docs/fee-tax-attachment-workspace-validation.md','docs/fee-precision-design.md','docs/fee-precision-design-validation.md','docs/fee-precision-module-validation.md','docs/fee-precision-selection-design.md','docs/fee-precision-selection-design-validation.md','docs/fee-precision-selection-file-validation.md','docs/fee-precision-selection-controller-validation.md','docs/fee-precision-selection-workspace-validation.md','docs/fee-application-design.md','docs/fee-application-design-validation.md','docs/fee-application-proposal-validation.md','docs/fee-envelope-design.md','docs/fee-envelope-design-validation.md','docs/fee-envelope-file-validation.md','docs/fee-envelope-handoff-validation.md','docs/fee-envelope-controller-validation.md','docs/fee-envelope-workspace-validation.md','docs/fee-application-transaction-validation.md','docs/fee-workbench-validation.md','docs/workbench-state-validation.md'];let checked=0;
files.push('docs/fee-workflow-guide-validation.md');
files.push('docs/fee-workflow-exercises-validation.md');
files.push('docs/post-application-requote-validation.md');
files.push('docs/fee-performance-baseline-validation.md');
for(const file of files){const text=readFileSync(resolve(root,file),'utf8');for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
 const target=match[1];if(/^(https?:|#)/.test(target))continue;
 const full=resolve(dirname(resolve(root,file)),target.split('#')[0]),path=relative(root,full);
 if(path.startsWith('..')||isAbsolute(path)||!existsSync(full))throw Error('Missing/invalid local evidence: '+file+' -> '+target);checked++;
}}
console.log('Capability evidence: '+checked+' local document/source/test links exist; no professional or real-business certification implied');
