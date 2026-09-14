import { COST_PRESETS } from '../data/cost-presets.js';
import type { ProjectFile } from '../data/project-file.js';
import type { BaseRef, CostItem } from '../domain/cost-item.js';
import type { Numeric } from '../domain/decimal.js';
import {
  CARRIAGE_MODES,
  CARRIAGE_MODE_LABELS,
  COST_CATEGORIES,
  COST_CATEGORY_LABELS,
  FX_TYPES,
  FX_TYPE_LABELS,
  INCOTERMS,
  OCCURRENCE_REASONS,
  OCCURRENCE_REASON_LABELS,
  PRICING_METHODS,
  PRICING_METHOD_LABELS,
  TIER_BASES,
  TIER_BASIS_LABELS,
  TIER_MODES,
  TIER_MODE_LABELS,
  TRADE_NODES,
  TRADE_NODE_LABELS,
  availableIncoterms,
  isIncotermAvailable,
  type PricingMethod,
  type Responsibility,
} from '../domain/enums.js';
import { DUTY_RATE_BASES, DUTY_RATE_BASIS_LABELS, DUTY_TYPES, DUTY_TYPE_LABELS } from '../domain/hs-rate.js';
import type { ShippingTerms } from '../domain/rule.js';
import type { FxRow } from './fx-rows.js';
import { dec, escapeHtml } from './format.js';

const BASE_LABELS: Record<'GOODS_VALUE' | 'QUOTE_AMOUNT' | 'CUSTOMS_DUTIABLE_VALUE', string> = {
  GOODS_VALUE: '货值',
  QUOTE_AMOUNT: '报价金额',
  CUSTOMS_DUTIABLE_VALUE: '完税价格',
};

const SHIPPING_TERMS: ShippingTerms[] = [
  'LINER',
  'UNDER_TACKLE',
  'STOWED',
  'TRIMMED',
  'STOWED_TRIMMED',
  'EX_SHIP_HOLD',
  'BULK',
];

const SHIPPING_TERM_LABELS: Record<ShippingTerms, string> = {
  LINER: '班轮条件（Liner Terms）',
  UNDER_TACKLE: '吊钩下交货（Under Tackle）',
  STOWED: '理舱费在内（Stowed）',
  TRIMMED: '平舱费在内（Trimmed）',
  STOWED_TRIMMED: 'FOBST（理舱平舱在内）',
  EX_SHIP_HOLD: '舱底交货（Ex Ship’s Hold）',
  BULK: '散货',
};

/** 计算后回填到录入区的信息：金额与归属，让用户边录边看到结果 */
export interface ItemEnrichment {
  base_amount: Numeric;
  responsibility: Responsibility;
  exclusion: string | null;
  rule_id: string | null;
  note: string;
}

function selectOptions<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
  selected: T | undefined,
): string {
  return values
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(labels[value])}</option>`,
    )
    .join('');
}

function itemAttr(costId: string, field: string): string {
  return `data-item="${escapeHtml(costId)}" data-item-field="${field}"`;
}

function panel(key: string, title: string, hint: string, body: string, open = true): string {
  return `<details class="panel" data-section="${escapeHtml(key)}"${open ? ' open' : ''}>
    <summary><span class="panel-title">${title}</span>${hint !== '' ? `<span class="hint">${hint}</span>` : ''}</summary>
    <div class="panel-body">${body}</div>
  </details>`;
}

/**
 * 计费参数那一栏的标签。
 *
 * 不叫"参数"——那是实现视角的词。当计费方式是固定金额或实际金额时，
 * 这个框里填的就是金额本身；叫参数等于把用户当程序员。
 * 标签跟着计费方式走，用户一眼知道这里要填什么。
 */
const PARAMS_LABELS: Record<PricingMethod, string> = {
  FIXED: '金额',
  ACTUAL: '金额',
  QTY_X_UNIT: '数量与单价',
  PERCENT: '比率与基数',
  PER_DAY: '天数与费率',
  TIERED: '计费量',
};

function renderItemParams(item: CostItem): string {
  const method = item.pricing_method;
  if (method === 'FIXED' || method === 'ACTUAL') {
    // 标签已经写明是"金额"，占位符改为示范格式：纯数字，不带货币符号与千分位
    return `<input type="text" inputmode="decimal" class="num" size="10" value="${escapeHtml(String(item.amount ?? ''))}" ${itemAttr(item.cost_id, 'amount')} placeholder="1200.00" />`;
  }
  if (method === 'QTY_X_UNIT') {
    return `<input type="text" inputmode="decimal" class="num" size="6" value="${escapeHtml(String(item.quantity ?? ''))}" ${itemAttr(item.cost_id, 'quantity')} placeholder="数量" />
      <span class="hint">×</span>
      <input type="text" inputmode="decimal" class="num" size="7" value="${escapeHtml(String(item.rate ?? ''))}" ${itemAttr(item.cost_id, 'rate')} placeholder="单价" />
      <input type="text" size="4" value="${escapeHtml(item.unit ?? '')}" ${itemAttr(item.cost_id, 'unit')} placeholder="单位" />`;
  }
  if (method === 'PERCENT') {
    return `<input type="text" inputmode="decimal" class="num" size="7" value="${escapeHtml(String(item.rate ?? ''))}" ${itemAttr(item.cost_id, 'rate')} placeholder="0.13" />
      <select ${itemAttr(item.cost_id, 'base')} title="按哪个金额计算百分比">
        ${(['GOODS_VALUE', 'QUOTE_AMOUNT', 'CUSTOMS_DUTIABLE_VALUE'] as const)
          .map(
            (kind) =>
              `<option value="${kind}"${((item.calculation_base?.kind ?? 'QUOTE_AMOUNT') as BaseRef['kind']) === kind ? ' selected' : ''}>${BASE_LABELS[kind]}</option>`,
          )
          .join('')}
      </select>`;
  }
  if (method === 'PER_DAY') {
    return `<input type="text" inputmode="decimal" class="num" size="5" value="${escapeHtml(String(item.days ?? ''))}" ${itemAttr(item.cost_id, 'days')} placeholder="天数" />
      <span class="hint">×</span>
      <input type="text" inputmode="decimal" class="num" size="7" value="${escapeHtml(String(item.rate ?? ''))}" ${itemAttr(item.cost_id, 'rate')} placeholder="日费率" />`;
  }
  if (method === 'TIERED') {
    // 计费量取数量还是天数由阶梯编辑器里的"计费量"决定，这里只给对应的输入框
    return (item.tier_basis ?? 'QUANTITY') === 'DAYS'
      ? `<span class="hint">天数</span><input type="text" inputmode="decimal" class="num" size="6" value="${escapeHtml(String(item.days ?? ''))}" ${itemAttr(item.cost_id, 'days')} placeholder="天数" />
         <span class="hint">按下方档位计费</span>`
      : `<span class="hint">数量</span><input type="text" inputmode="decimal" class="num" size="6" value="${escapeHtml(String(item.quantity ?? ''))}" ${itemAttr(item.cost_id, 'quantity')} placeholder="数量" />
         <span class="hint">按下方档位计费</span>`;
  }
  return '<span class="hint">未知计费方式</span>';
}

/** 阶梯档位编辑器。上界留空表示"以上"，仅允许最后一档留空。 */
function renderTierEditor(item: CostItem): string {
  if (item.pricing_method !== 'TIERED') return '';
  const tiers = item.tiers ?? [];
  const mode = item.tier_mode ?? 'MARGINAL';
  const basis = item.tier_basis ?? 'QUANTITY';

  // 展示顺序按上界升序，与引擎的排序一致；data-tier-index 仍指向原始下标
  const ordered = tiers
    .map((tier, index) => ({ tier, index }))
    .sort((a, b) => {
      if (a.tier.up_to === null) return 1;
      if (b.tier.up_to === null) return -1;
      return Number(a.tier.up_to) - Number(b.tier.up_to);
    });

  let lower = '0';
  const rows = ordered
    .map(({ tier, index }) => {
      const upperLabel = tier.up_to === null ? '以上' : String(tier.up_to);
      const row = `<div class="tier-row">
        <span class="tier-range">${escapeHtml(lower)} – ${escapeHtml(upperLabel)}</span>
        <label class="f"><span>上界</span><input type="text" inputmode="decimal" class="num" size="7" value="${escapeHtml(tier.up_to === null ? '' : String(tier.up_to))}" ${itemAttr(item.cost_id, 'tier-up')} data-tier-index="${index}" placeholder="以上" /></label>
        <label class="f"><span>费率</span><input type="text" inputmode="decimal" class="num" size="8" value="${escapeHtml(String(tier.rate))}" ${itemAttr(item.cost_id, 'tier-rate')} data-tier-index="${index}" /></label>
        <button class="ghost icon danger" data-action="remove-tier" data-item="${escapeHtml(item.cost_id)}" data-tier-index="${index}" title="删除该档位">✕</button>
      </div>`;
      lower = upperLabel;
      return row;
    })
    .join('');

  /*
   * 分档 + 择低时，若更高的档位费率还是 0（预设填的占位值），
   * "取低"会直接取到 0、整笔费用归零。数学上没错，但十有八九是没填，
   * 因此在录入处就地提示，而不是改动计算。
   */
  const zeroRateCount =
    mode === 'FLAT' && item.tier_charge_lower === true
      ? tiers.filter((tier) => Number(tier.rate) === 0).length
      : 0;

  return `<div class="tier-editor">
    <div class="tier-head">
      <span class="tier-title">阶梯档位</span>
      <label class="f"><span>方式</span><select ${itemAttr(item.cost_id, 'tier_mode')}>${selectOptions(TIER_MODES, TIER_MODE_LABELS, mode)}</select></label>
      <label class="f"><span>计费量</span><select ${itemAttr(item.cost_id, 'tier_basis')}>${selectOptions(TIER_BASES, TIER_BASIS_LABELS, basis)}</select></label>
      ${
        mode === 'FLAT'
          ? `<label class="f tier-lower" title="空运重量等级运价规则：实际计费量按所在档费率算，与更高档位最小计费量按该档费率算，取低者">
               <input type="checkbox" ${itemAttr(item.cost_id, 'tier_charge_lower')} ${item.tier_charge_lower === true ? 'checked' : ''} />按高一档择低
             </label>`
          : ''
      }
      <button class="small" data-action="add-tier" data-item="${escapeHtml(item.cost_id)}">＋ 档位</button>
    </div>
    ${tiers.length === 0 ? '<p class="hint">还没有档位，点"＋ 档位"添加</p>' : rows}
    ${
      zeroRateCount > 0
        ? `<p class="hint">有 ${zeroRateCount} 个档位费率为 0。「按高一档择低」会取到这些 0，使整笔费用变成 0——请确认是否已填写各档费率</p>`
        : ''
    }
  </div>`;
}

function responsibilityTag(responsibility: Responsibility | undefined): string {
  if (responsibility === undefined) return '<span class="tag muted">—</span>';
  if (responsibility === 'SELLER') return '<span class="tag seller">卖方</span>';
  if (responsibility === 'BUYER') return '<span class="tag buyer">买方</span>';
  if (responsibility === 'CONDITIONAL') return '<span class="tag conditional">待确认</span>';
  return '<span class="tag muted">共担</span>';
}

function renderItemCard(item: CostItem, allItems: readonly CostItem[], enrichment: ItemEnrichment | undefined): string {
  const needsConfirm = enrichment !== undefined && enrichment.responsibility === 'CONDITIONAL';
  const parent = allItems.find((candidate) => candidate.cost_id === item.contained_in_cost_id);
  return `<div class="item-card${needsConfirm ? ' needs-confirm' : ''}">
    <div class="item-head">
      <input class="item-name" type="text" value="${escapeHtml(item.cost_name)}" ${itemAttr(item.cost_id, 'cost_name')} />
      ${item.is_custom ? '<span class="tag muted">自定义</span>' : ''}
      ${item.source === 'DERIVED' ? '<span class="tag muted">系统推算</span>' : ''}
      <span class="item-spacer"></span>
      <span class="item-amount">${enrichment !== undefined ? dec(enrichment.base_amount) : '—'}<small>${escapeHtml(item.currency)}</small></span>
      ${responsibilityTag(enrichment?.responsibility)}
      <button class="ghost icon danger" data-action="remove-item" data-item="${escapeHtml(item.cost_id)}" title="删除该费用">✕</button>
    </div>
    <div class="item-fields">
      <label class="f"><span>贸易节点</span><select ${itemAttr(item.cost_id, 'trade_node')}>${selectOptions(TRADE_NODES, TRADE_NODE_LABELS, item.trade_node)}</select></label>
      <label class="f"><span>类别</span><select ${itemAttr(item.cost_id, 'cost_category')}>${selectOptions(COST_CATEGORIES, COST_CATEGORY_LABELS, item.cost_category)}</select></label>
      <label class="f"><span>计费方式</span><select ${itemAttr(item.cost_id, 'pricing_method')}>${selectOptions(PRICING_METHODS, PRICING_METHOD_LABELS, item.pricing_method)}</select></label>
      <span class="f params"><span>${PARAMS_LABELS[item.pricing_method]}</span>${renderItemParams(item)}</span>
      <label class="f"><span>币种</span><input type="text" size="5" value="${escapeHtml(item.currency)}" ${itemAttr(item.cost_id, 'currency')} /></label>
      <label class="f"><span>汇率类型</span><select ${itemAttr(item.cost_id, 'fx_type')}>${selectOptions(FX_TYPES, FX_TYPE_LABELS, item.fx_type)}</select></label>
      <label class="f"><span>汇率日期</span><input type="text" size="10" value="${escapeHtml(item.fx_date ?? '')}" ${itemAttr(item.cost_id, 'fx_date')} placeholder="可留空" /></label>
      <label class="f"><span>发生原因</span><select ${itemAttr(item.cost_id, 'occurrence_reason')}>
        <option value=""${item.occurrence_reason === undefined ? ' selected' : ''}>正常作业</option>
        ${selectOptions(OCCURRENCE_REASONS, OCCURRENCE_REASON_LABELS, item.occurrence_reason)}
      </select></label>
      <label class="f"><span>已含于</span><select ${itemAttr(item.cost_id, 'contained_in')} data-lazy-options="contained-in" title="该费用的金额已含在另一笔费用内">
        <option value=""${item.contained_in_cost_id === undefined ? ' selected' : ''}>未含于他项</option>
        ${
          // 只渲染当前值。完整候选列表在获得焦点时再填，见 app.ts 的 populateContainedIn。
          // 若在这里列出全部费用项，300 笔费用会产生约 9 万个 option，
          // 界面直接卡死（引擎只需 30ms，瓶颈全在 DOM）。
          parent !== undefined
            ? `<option value="${escapeHtml(parent.cost_id)}" selected>${escapeHtml(parent.cost_name)}</option>`
            : ''
        }
      </select></label>
      <span class="f flags">
        <label title="该费用已打进成交报价"><input type="checkbox" ${itemAttr(item.cost_id, 'included_in_quoted_price')} ${item.included_in_quoted_price ? 'checked' : ''} />含于报价</label>
        <label title="该项代表货物本身的价值"><input type="checkbox" ${itemAttr(item.cost_id, 'is_goods_value')} ${item.is_goods_value === true ? 'checked' : ''} />代表货值</label>
        <label title="该笔主运输报价已声明包含港口操作费"><input type="checkbox" ${itemAttr(item.cost_id, 'includes_port_charges')} ${item.includes_port_charges === true ? 'checked' : ''} />运费含港杂</label>
      </span>
    </div>
    ${renderTierEditor(item)}
    ${
      enrichment !== undefined && enrichment.note !== ''
        ? `<div class="item-note">${enrichment.rule_id !== null ? `<code class="rule">${escapeHtml(enrichment.rule_id)}</code> ` : ''}${escapeHtml(enrichment.note)}</div>`
        : ''
    }
  </div>`;
}

export function renderFormsRow(project: ProjectFile): string {
  const available = availableIncoterms(project.carriage_mode);
  const goodsBody = `
    <div class="field-grid">
      <label class="field wide">项目名称<input type="text" value="${escapeHtml(project.name)}" data-path="name" /></label>
      <label class="field">核算币种<input type="text" value="${escapeHtml(project.base_currency)}" data-path="base_currency" /></label>
      <label class="field">运输方式<select data-path="carriage_mode">${selectOptions(CARRIAGE_MODES, CARRIAGE_MODE_LABELS, project.carriage_mode)}</select></label>
      <label class="field">出口日期<input type="text" value="${escapeHtml(project.export_date ?? '')}" data-path="export_date" placeholder="YYYY-MM-DD" /></label>
      <label class="field wide">商品名称<input type="text" value="${escapeHtml(project.goods.name)}" data-path="goods.name" /></label>
      <label class="field">数量<input type="text" inputmode="decimal" class="num" value="${escapeHtml(String(project.goods.quantity))}" data-path="goods.quantity" /></label>
      <label class="field">单位<input type="text" value="${escapeHtml(project.goods.unit)}" data-path="goods.unit" /></label>
      <label class="field">成交货值<input type="text" inputmode="decimal" class="num" value="${escapeHtml(String(project.goods.trade_value.amount))}" data-path="goods.trade_value.amount" /></label>
      <label class="field">货值币种<input type="text" value="${escapeHtml(project.goods.trade_value.currency)}" data-path="goods.trade_value.currency" /></label>
      <label class="field">卖方采购含税成本<input type="text" inputmode="decimal" class="num" value="${escapeHtml(String(project.goods.seller_goods_cost.amount))}" data-path="goods.seller_goods_cost.amount" /></label>
      <label class="field">成本币种<input type="text" value="${escapeHtml(project.goods.seller_goods_cost.currency)}" data-path="goods.seller_goods_cost.currency" /></label>
      <label class="field">商品编码（税率表键）<input type="text" list="hs-code-options" value="${escapeHtml(project.goods.tax_key ?? '')}" data-path="goods.tax_key" /></label>
    </div>
    ${
      (project.tax_profile.import.hsTable?.entries.length ?? 0) > 0
        ? `<datalist id="hs-code-options">${(project.tax_profile.import.hsTable?.entries ?? [])
            .map((entry) => `<option value="${escapeHtml(entry.code)}">${escapeHtml(entry.description)}</option>`)
            .join('')}</datalist>`
        : ''
    }`;

  const quoteBody = `
    <div class="field-grid">
      <label class="field">报价金额<input type="text" inputmode="decimal" class="num" value="${escapeHtml(project.quote.amount)}" data-path="quote.amount" /></label>
      <label class="field">报价币种<input type="text" value="${escapeHtml(project.quote.currency)}" data-path="quote.currency" /></label>
      <label class="field">报价所用汇率类型<select data-path="quote.fx_type">${selectOptions(FX_TYPES, FX_TYPE_LABELS, project.quote.fx_type)}</select></label>
      <label class="field">报价汇率日期<input type="text" value="${escapeHtml(project.quote.fx_date ?? '')}" data-path="quote.fx_date" placeholder="YYYY-MM-DD" /></label>
      <label class="field">贸易术语<select data-path="incoterm">
        ${INCOTERMS.map(
          (incoterm) =>
            `<option value="${incoterm}"${incoterm === project.incoterm ? ' selected' : ''}${isIncotermAvailable(project.carriage_mode, incoterm) ? '' : ' disabled'}>${incoterm}${isIncotermAvailable(project.carriage_mode, incoterm) ? '' : '（不适用当前运输方式）'}</option>`,
        ).join('')}
      </select></label>
      <label class="field">比较基准<select data-path="anchor.kind">
        <option value="FIXED_QUOTE"${project.anchor.kind === 'FIXED_QUOTE' ? ' selected' : ''}>A 固定报价金额</option>
        <option value="FIXED_MARKET_PRICE"${project.anchor.kind === 'FIXED_MARKET_PRICE' ? ' selected' : ''}>B 固定买方总支付</option>
        <option value="FIXED_MARGIN_RATE"${project.anchor.kind === 'FIXED_MARGIN_RATE' ? ' selected' : ''}>C 固定目标利润率</option>
      </select></label>
      ${
        project.anchor.kind === 'FIXED_MARKET_PRICE'
          ? `<label class="field">买方总支付<input type="text" inputmode="decimal" class="num" value="${escapeHtml(String(project.anchor.buyer_total))}" data-path="anchor.buyer_total" /></label>
             <label class="field">该金额币种<input type="text" value="${escapeHtml(project.anchor.currency)}" data-path="anchor.currency" /></label>`
          : ''
      }
      ${
        project.anchor.kind === 'FIXED_MARGIN_RATE'
          ? `<label class="field">目标毛利率<input type="text" inputmode="decimal" class="num" value="${escapeHtml(String(project.anchor.margin_rate))}" data-path="anchor.margin_rate" placeholder="如 0.2" /></label>`
          : ''
      }
      <label class="field">FCA 交货地点<select data-path="facts.delivery_place">
        <option value=""${project.facts?.delivery_place === undefined ? ' selected' : ''}>未指定</option>
        <option value="SELLER_PREMISES"${project.facts?.delivery_place === 'SELLER_PREMISES' ? ' selected' : ''}>卖方场所</option>
        <option value="OTHER"${project.facts?.delivery_place === 'OTHER' ? ' selected' : ''}>其他指定地点</option>
      </select></label>
      <label class="field">运输条款变形<select data-path="facts.shipping_terms">
        <option value=""${project.facts?.shipping_terms === undefined ? ' selected' : ''}>未指定</option>
        ${SHIPPING_TERMS.map((term) => `<option value="${term}"${project.facts?.shipping_terms === term ? ' selected' : ''}>${SHIPPING_TERM_LABELS[term]}</option>`).join('')}
      </select></label>
      <label class="field">出口清关代办<select data-path="facts.clearance_agent">
        <option value=""${project.facts?.clearance_agent === undefined ? ' selected' : ''}>未指定</option>
        <option value="SELLER_ACTS_FOR_BUYER"${project.facts?.clearance_agent === 'SELLER_ACTS_FOR_BUYER' ? ' selected' : ''}>卖方代买方办理</option>
      </select></label>
    </div>
    <p class="hint block">当前运输方式（${CARRIAGE_MODE_LABELS[project.carriage_mode]}）下可用术语：${available.join(' / ')}</p>`;

  return `
  <div class="row-forms">
    ${panel('goods', '交易与商品', '', goodsBody)}
    ${panel('quote', '报价与方案', '', quoteBody)}
  </div>`;
}

export function renderFxPanel(fxRows: readonly FxRow[]): string {
  const body = `
    <div class="fx-list">
      ${fxRows
        .map(
          (row) => `<div class="fx-row">
        <label class="f"><span>类型</span><select data-fx="${escapeHtml(row.row_id)}" data-fx-field="type">${selectOptions(FX_TYPES, FX_TYPE_LABELS, row.type)}</select></label>
        <label class="f"><span>生效日期</span><input type="text" size="10" value="${escapeHtml(row.date)}" data-fx="${escapeHtml(row.row_id)}" data-fx-field="date" placeholder="YYYY-MM-DD" /></label>
        <label class="f"><span>有效期起</span><input type="text" size="10" value="${escapeHtml(row.valid_from ?? '')}" data-fx="${escapeHtml(row.row_id)}" data-fx-field="valid_from" placeholder="可留空" /></label>
        <label class="f"><span>有效期止</span><input type="text" size="10" value="${escapeHtml(row.valid_to ?? '')}" data-fx="${escapeHtml(row.row_id)}" data-fx-field="valid_to" placeholder="可留空" /></label>
        <span class="f params"><span>币种对</span>
          <input type="text" size="5" value="${escapeHtml(row.from)}" data-fx="${escapeHtml(row.row_id)}" data-fx-field="from" />
          <span class="hint">/</span>
          <input type="text" size="5" value="${escapeHtml(row.to)}" data-fx="${escapeHtml(row.row_id)}" data-fx-field="to" />
        </span>
        <label class="f"><span>汇率</span><input type="text" inputmode="decimal" class="num" size="9" value="${escapeHtml(row.rate)}" data-fx="${escapeHtml(row.row_id)}" data-fx-field="rate" /></label>
        <button class="ghost icon danger" data-action="remove-fx" data-fx="${escapeHtml(row.row_id)}" title="删除该行">✕</button>
      </div>`,
        )
        .join('')}
    </div>
    <div class="panel-actions">
      <button data-action="add-fx">增加一行汇率</button>
      <span class="hint">海关汇率按月锁定，请填有效期起止</span>
    </div>`;
  return panel('fx', '汇率', '商业、合同、海关三类各自独立，互不替代', body);
}

export function renderItemsPanel(
  project: ProjectFile,
  enrichment: ReadonlyMap<string, ItemEnrichment>,
): string {
  const presetOptions = COST_PRESETS.map(
    (preset) =>
      `<option value="${escapeHtml(preset.key)}">${escapeHtml(preset.name)}（${COST_CATEGORY_LABELS[preset.cost_category]}）</option>`,
  ).join('');

  const conditionalCount = [...enrichment.values()].filter(
    (entry) => entry.responsibility === 'CONDITIONAL',
  ).length;

  const body = `
    <div class="item-list">
      ${project.items.map((item) => renderItemCard(item, project.items, enrichment.get(item.cost_id))).join('')}
    </div>
    <div class="panel-actions">
      <select data-action="add-preset">
        <option value="">从常用费用里选择…</option>
        ${presetOptions}
      </select>
      <button data-action="add-custom">添加自定义费用</button>
      <span class="hint">共 ${project.items.length} 项${conditionalCount > 0 ? ` · ${conditionalCount} 项归属待确认` : ''}</span>
    </div>`;
  return panel('items', '费用项', '归属不看名称，只看节点、类别、发生原因与术语', body);
}

/** HS 税率表：与汇率行同样的行式编辑，编码逐级回退由引擎负责 */
export function renderHsPanel(project: ProjectFile): string {
  const hsTable = project.tax_profile.import.hsTable;
  const basis = hsTable?.basis ?? 'MFN';
  const entries = hsTable?.entries ?? [];

  const rows = entries
    .map(
      (entry, index) => `<div class="fx-row">
        <label class="f"><span>编码</span><input type="text" size="11" value="${escapeHtml(entry.code)}" data-hs="${index}" data-hs-field="code" placeholder="85183000" /></label>
        <label class="f"><span>描述</span><input type="text" size="20" value="${escapeHtml(entry.description)}" data-hs="${index}" data-hs-field="description" /></label>
        <label class="f"><span>计征方式</span><select data-hs="${index}" data-hs-field="duty_type">${selectOptions(DUTY_TYPES, DUTY_TYPE_LABELS, entry.duty_type ?? 'AD_VALOREM')}</select></label>
        <label class="f"><span>关税税率</span><input type="text" inputmode="decimal" class="num" size="7" value="${escapeHtml(String(entry.duty_rates?.[basis] ?? ''))}" data-hs="${index}" data-hs-field="duty_rate" placeholder="0.037" /></label>
        <label class="f"><span>增值税率</span><input type="text" inputmode="decimal" class="num" size="6" value="${escapeHtml(String(entry.vat_rate ?? ''))}" data-hs="${index}" data-hs-field="vat_rate" placeholder="可留空" /></label>
        <label class="f"><span>消费税率</span><input type="text" inputmode="decimal" class="num" size="6" value="${escapeHtml(String(entry.consumption_tax_rate ?? ''))}" data-hs="${index}" data-hs-field="consumption_tax_rate" placeholder="可留空" /></label>
        <span class="f params"><span>从量</span>
          <input type="text" inputmode="decimal" class="num" size="7" value="${escapeHtml(String(entry.specific_amount ?? ''))}" data-hs="${index}" data-hs-field="specific_amount" placeholder="单位税额" />
          <span class="hint">/</span>
          <input type="text" size="4" value="${escapeHtml(entry.specific_unit ?? '')}" data-hs="${index}" data-hs-field="specific_unit" placeholder="单位" />
        </span>
        <button class="ghost icon danger" data-action="remove-hs" data-hs="${index}" title="删除该编码">✕</button>
      </div>`,
    )
    .join('');

  const body = `
    <div class="panel-actions" style="margin:0 0 8px">
      <label class="f"><span>适用口径</span><select data-path="tax_profile.import.hsTable.basis">${selectOptions(DUTY_RATE_BASES, DUTY_RATE_BASIS_LABELS, basis)}</select></label>
      <button data-action="add-hs">＋ 编码</button>
      <span class="hint">关税税率按所选口径填写；下级编码未维护时自动按上级编码计算</span>
    </div>
    ${entries.length === 0 ? '<p class="hint">还没有编码。不填时按上面「商品大类兜底税率」计算。</p>' : `<div class="fx-list">${rows}</div>`}`;

  return panel('hs', 'HS 税率表', '命中编码时优先于兜底税率', body, false);
}

export function nextCostId(project: ProjectFile, prefix = 'cost'): string {
  let index = project.items.length + 1;
  let candidate = `${prefix}-${index}`;
  const taken = new Set(project.items.map((item) => item.cost_id));
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${prefix}-${index}`;
  }
  return candidate;
}
