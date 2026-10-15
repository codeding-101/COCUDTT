import { isEngineError } from '../engine/errors.js';
export const INPUT_SECTION_LABELS = {goods:'交易与商品',quote:'报价与方案','import-tax':'进口税务口径',fx:'汇率',hs:'HS税率表',items:'费用项',contract:'合同报价与费用约定'} as const;
export type InputSection = keyof typeof INPUT_SECTION_LABELS;
/** Broad, truthful destinations. Error text alone is insufficient to identify a particular input. */
export function inputSections(error: unknown): InputSection[] {
  if (!isEngineError(error)) return [];
  const code = error.code;
  if (code.startsWith('FX_')) return ['fx'];
  if (code === 'PRICING_CURRENCY_MISMATCH') return ['items','fx'];
  if (code === 'CN_IMPORT_CONTEXT_INVALID' || code === 'TAX_INPUT_INVALID') return ['import-tax','hs'];
  if (code.startsWith('HS_')) return ['hs','goods'];
  if (code === 'INCOTERM_MODE_INCOMPATIBLE') return ['goods','quote'];
  if (code === 'ANCHOR_MARGIN_INVALID') return ['quote'];
  if (code === 'CONTRACT_CLAUSE_TOO_BROAD') return ['contract','items'];
  if (code === 'INPUT_VALUE_MISSING') return ['goods','quote','contract'];
  if (code.startsWith('PRICING_') || ['GRAPH_CYCLE','COST_ITEM_NOT_FOUND','DUPLICATE_COST_ID'].includes(code)) return ['items'];
  return [];
}
export function focusInputSection(section: InputSection): boolean {
  const panel = [...document.querySelectorAll<HTMLDetailsElement>('details[data-section]')].find(el => el.dataset.section === section);
  if (!panel) return false;
  for(let parent=panel.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')(parent as HTMLDetailsElement).open=true;
  panel.open = true;
  const summary = panel.querySelector<HTMLElement>('summary');
  if (summary) { summary.tabIndex = -1; summary.focus({preventScroll:true}); }
  panel.scrollIntoView({block:'start'});
  return true;
}
