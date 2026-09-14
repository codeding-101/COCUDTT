import type { Numeric } from './decimal.js';
import type { Money } from './money.js';

export interface Goods {
  name: string;
  quantity: Numeric;
  unit: string;

  /** 成交货值：对买方而言的货物价格，用于报价拆分与海关完税价格（设计文档 11.4） */
  trade_value: Money;

  /**
   * 卖方货物成本：外贸企业为含税采购价，生产企业为生产成本。
   * 与 trade_value 是两个不同的数，不可混用。
   */
  seller_goods_cost: Money;

  /** 商品大类或 HS 编码，用于查税率表 */
  tax_key?: string;
}
