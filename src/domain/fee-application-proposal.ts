/** Transient read-only input, not a new project, ledger or application file format. */
export interface FeeApplicationProposalSources {
 project_json:string;
 bill_json:string;
 pair_json:string;
 attachment_json:string;
 precision_json:string;
 /** Opaque history evidence only. No supported ledger format exists yet. */
 history_json:string|null;
}
export class FeeApplicationProposalError extends Error {
 constructor(readonly reason:string){super('FEE_APPLICATION_PROPOSAL_INVALID:'+reason);this.name='FeeApplicationProposalError';}
}
