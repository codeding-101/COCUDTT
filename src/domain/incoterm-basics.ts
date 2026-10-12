import type { Incoterm } from './enums.js';

/** ICC Incoterms 2020 A2/A5/A7：交货作业、投保义务与费用承担分别建模。 */
export function incotermBasics(term: Incoterm) {
  return {
    required_seller_insurance: term === 'CIF' ? 'ICC_C' : term === 'CIP' ? 'ICC_A' : null,
    delivery_requires_destination_unloading: term === 'DPU',
    export_clearance: term === 'EXW' ? 'BUYER' : 'SELLER',
    import_clearance_and_tax_costs: term === 'DDP' ? 'SELLER' : 'BUYER',
    freight_risk_separated: ['CFR', 'CIF', 'CPT', 'CIP'].includes(term),
  } as const;
}
