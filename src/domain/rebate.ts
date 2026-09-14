import type { RebateEntityType } from './enums.js';
import type { TaxRateTable } from './rate-table.js';
import type { Numeric } from './decimal.js';

/**
 * 出口退税配置（设计文档 9.5）。
 *
 * 两种主体的计算路径完全不同：
 * - TRADING（外贸企业，免退税）：退税基数 = 增值税专用发票不含税金额，与出口售价及术语无关
 * - MANUFACTURER（生产企业，免抵退税）：退税基数 = 出口离岸价 FOB，随术语变化
 */
export interface RebateProfile {
  entityType: RebateEntityType;
  /** 按商品维护的退税率 */
  rebateRates: TaxRateTable;
  /** 按商品维护的征税率 */
  vatRates: TaxRateTable;
  /** 退税到账周期（天）。启用后计算资金占用成本，默认不启用 */
  rebateLagDays?: number;
  /** 卖方年化资金成本率，仅 rebateLagDays 启用时使用 */
  sellerFundingRate?: Numeric;
  /** 生产企业期末留抵税额。未给定则退税额按理论值计算，
   * 结果中标记为上限值（设计文档 9.5.7）。
   */
  endingCreditBalance?: Numeric;
  /** 出口应税消费品的消费税退税率，未设置则不计退税 */
  consumption_tax_rebate_rate?: Numeric;
}
