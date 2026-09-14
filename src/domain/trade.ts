import type { CarriageMode, CurrencyCode, DateStr } from './enums.js';
import type { CostItem } from './cost-item.js';
import type { Goods } from './goods.js';

/** 交易事实层：与贸易术语无关的客观事实（设计文档第 2 节） */
export interface Trade {
  id: string;
  name: string;
  goods: Goods;
  carriage_mode: CarriageMode;
  items: CostItem[];
  /** 出口日期，用于按天计费与退税申报期限判断 */
  export_date?: DateStr;
  /** 统一核算币种 */
  base_currency: CurrencyCode;
  notes?: string;
}
