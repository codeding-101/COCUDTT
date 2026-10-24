/** Shared controlled probe for Node and an isolated browser page; never loads the live app. */
import {WorkbenchStateOwner} from '../src/ui/workbench-state';
import {openedFileEvidence} from '../src/ui/file-evidence';
import {inspectRecoveryText} from '../src/data/recovery-review';
import {encodeRuntimeFeeBackup} from '../src/data/runtime-fee-backup';
import {FeeBrowserCaptureContract, type FeeBrowserCaptureCodec} from './fee-browser-capture-contract';
import {FEE_BROWSER_RECOVERY_DESIGN_LIMITS, FEE_BROWSER_SOURCE_KEYS, planFeeBrowserRecovery} from './fee-browser-recovery-plan';
import {feeLayeredParts} from './fee-layered-capture-cases';
const deferred = <T,>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(ok => {resolve = ok;}); return {promise, resolve};};
const resultCode = (p: Promise<unknown>) => p.then(() => 'RESOLVED', e => Object.getOwnPropertyDescriptor(e, 'code')?.value ?? 'UNKNOWN');
export async function probeFeeBrowserRecoveryContract(codec: FeeBrowserCaptureCodec) {
  const cases: {id: string; checks: Record<string, boolean>}[] = [], wires: {id: string; wire: string}[] = [];
  const record = (id: string, checks: Record<string, boolean>) => {cases.push({id, checks});};
  const roots = [null, -0, {raw: '\ufeff 中😀\r\n"\\'.repeat(180)}, JSON.parse('{"__proto__":{"preserved":true},"ref":0}'), [[], {nested: [true, null]}]];
  for (const format of ['COMPACT','PRETTY_LF'] as const) for (const [index, root] of roots.entries()) {
    const owner = new WorkbenchStateOwner(), checkpoint = owner.checkpoint(), session = new FeeBrowserCaptureContract(owner, codec), input = feeLayeredParts(root, format), issued = await session.capture(() => input), wire = session.exportWire(issued), foreign = new FeeBrowserCaptureContract(owner, codec);
    const id = 'wire-' + format + '-' + index; wires.push({id, wire}); record(id, {current: session.isCurrent(issued), copy_refused: !session.isCurrent(JSON.parse(JSON.stringify(issued))),
      foreign_refused: !foreign.isCurrent(issued), restored_refused: !session.isCurrent(issued.restoration), owner_kept: owner.isCurrent(checkpoint),
      no_authority: issued.financial_writes === 0 && issued.import_authority === false && issued.confirmation_authority === false && issued.restoration.import_authority === false && issued.restoration.confirmation_authority === false});
    session.dispose(); foreign.dispose();
  }
  for (const stage of ['READING','ENCODING','VERIFYING'] as const) for (const action of ['cancel','signal','dispose','replace'] as const) {
    const reached = deferred<void>(), gate = deferred<void>(), external = new AbortController(), owner = new WorkbenchStateOwner(), checkpoint = owner.checkpoint(); let first = true;
    const wait = async (at: string) => {if (first && at === stage) {first = false; reached.resolve(); await gate.promise;}};
    const session = new FeeBrowserCaptureContract(owner, {encode: async (p, s) => {await wait('ENCODING'); return codec.encode(p, s);}, decode: async (w, s) => {await wait('VERIFYING'); return codec.decode(w, s);}});
    const old = resultCode(session.capture(async () => {await wait('READING'); return feeLayeredParts();}, external.signal)); await reached.promise; const before = session.state(); let latest;
    if (action === 'cancel') session.cancel(); else if (action === 'signal') external.abort('PRIVATE_REASON'); else if (action === 'dispose') session.dispose(); else latest = await session.capture(() => feeLayeredParts());
    const code = await old; // Must finish before releasing the unresolved read/hash/verification backend.
    gate.resolve(); await Promise.resolve(); await Promise.resolve();
    record('cancel-' + stage + '-' + action, {phase_observed: before === stage, prompt_rejection: code === (action === 'dispose' ? 'CLOSED' : 'CANCELLED'),
      newer_kept: !latest || session.isCurrent(latest), owner_kept: owner.isCurrent(checkpoint)}); session.dispose();
  }
  for (const stage of ['READING','ENCODING','VERIFYING'] as const) for (const action of ['change','ABA'] as const) {
    const reached = deferred<void>(), gate = deferred<void>(), owner = new WorkbenchStateOwner(), source = {raw: 'A'}; owner.bind(source, 'fixture');
    const wait = async (at: string) => {if (at === stage) {reached.resolve(); await gate.promise;}};
    const session = new FeeBrowserCaptureContract(owner, {encode: async (p, s) => {await wait('ENCODING'); return codec.encode(p, s);}, decode: async (w, s) => {await wait('VERIFYING'); return codec.decode(w, s);}});
    const old = resultCode(session.capture(async () => {await wait('READING'); return feeLayeredParts();})); await reached.promise;
    source.raw = 'B'; if (action === 'ABA') source.raw = 'A'; gate.resolve(); record('owner-' + stage + '-' + action, {stale_refused: await old === 'STALE', no_issued_view: session.state() === 'IDLE'}); session.dispose();
  }
  for (const stage of ['ENCODING','VERIFYING'] as const) {
    const owner = new WorkbenchStateOwner(); let encoded = 0, decoded = 0;
    const session = new FeeBrowserCaptureContract(owner, {encode: async (p, s) => {encoded++; const result = codec.encode(p, s); if (stage === 'ENCODING') queueMicrotask(() => owner.touch()); return result;},
      decode: async (w, s) => {decoded++; const result = codec.decode(w, s); queueMicrotask(() => owner.touch()); return result;}});
    record('async-backend-' + stage, {stale_refused: await resultCode(session.capture(() => feeLayeredParts())) === 'STALE', encode_started: encoded === 1, decode_boundary: decoded === (stage === 'VERIFYING' ? 1 : 0)}); session.dispose();
  }
  {
    const owner = new WorkbenchStateOwner(), gate = deferred<ReturnType<typeof feeLayeredParts>>(), session = new FeeBrowserCaptureContract(owner, codec); let newest!: ReturnType<FeeBrowserCaptureContract['capture']>;
    const first = resultCode(session.capture(signal => {signal.addEventListener('abort', () => {newest = session.capture(() => feeLayeredParts({latest: true}));}); return gate.promise;}));
    const middle = resultCode(session.capture(() => feeLayeredParts())), issued = await newest;
    record('abort-listener-reentrancy', {first_cancelled: await first === 'CANCELLED', middle_cancelled: await middle === 'CANCELLED', newest_current: session.isCurrent(issued)}); gate.resolve(feeLayeredParts()); session.dispose();
  }
  const shell = feeLayeredParts().capture_shell;
  for (const key of FEE_BROWSER_SOURCE_KEYS) {const raw = 'SYNTHETIC_PRIVATE_' + key; if (key === 'envelope') shell.envelope_json = raw; else shell.sources[`${key}_json`] = raw; shell.files[key] = openedFileEvidence(raw, key + '.json');}
  shell.editors.pending_input = ''; const plan = planFeeBrowserRecovery(shell, {capture: 'ACCEPTED', backup: 'WRITER_ACKNOWLEDGED'});
  record('six-files-are-partial-recovery', {six_texts_match: plan.all_six_match_known_file_text, pending_retained: plan.uncommitted_editors.includes('pending_input'),
    full_reopen_unavailable: plan.full_workbench_reopen === 'NOT_IMPLEMENTED', no_full_backup_claim: plan.source_files_are_complete_workbench_backup === false,
    no_authority: plan.import_authority === false && plan.confirmation_authority === false, no_disk_claim: plan.physical_disk_verified === false, no_raw_values: !JSON.stringify(plan).includes('SYNTHETIC_PRIVATE_')});
  for (const [kind, version] of [['INTERNAL_RUNTIME_FEE_WORKBENCH_CHECK_BACKUP','0.1'],['INTERNAL_RUNTIME_FEE_WORKBENCH_CHECK_BACKUP','0.2'],['INTERNAL_RUNTIME_FEE_APPLICATION_BACKUP','0.1'],['INTERNAL_RUNTIME_FEE_BACKUP_ARCHIVE','0.1']]) {
    const raw = JSON.stringify({kind, version, import_authority: false}); let refused = false; try {inspectRecoveryText(raw);} catch {refused = true;}
    record('exception-refuses-' + kind + '-' + version, {small_backup_kept: encodeRuntimeFeeBackup(raw) === raw, actual_inspector_refused: refused});
  }
  let wireRefused = false; try {inspectRecoveryText(wires[0]!.wire);} catch {wireRefused = true;}
  record('exception-refuses-layered-wire', {actual_inspector_refused: wireRefused});
  const reviewed = inspectRecoveryText(JSON.stringify({kind: 'INTERNAL_RECOVERY_SNAPSHOT', version: '1.0', stage: 'INTERACTION'}));
  record('exception-review-is-structural', {recognized_parts_missing: reviewed.parts.every(p => p.status === 'MISSING'), no_complete_reopen: plan.full_workbench_reopen === 'NOT_IMPLEMENTED'});
  record('five-distinct-byte-ceilings', {capture_128: FEE_BROWSER_RECOVERY_DESIGN_LIMITS.capture_semantic_bytes === 134217728,
    raw_256: FEE_BROWSER_RECOVERY_DESIGN_LIMITS.backup_raw_bytes === 268435456, plain_48: FEE_BROWSER_RECOVERY_DESIGN_LIMITS.backup_plain_bytes === 50331648,
    archive_64: FEE_BROWSER_RECOVERY_DESIGN_LIMITS.backup_encoded_bytes === 67108864, exception_5: FEE_BROWSER_RECOVERY_DESIGN_LIMITS.exception_review_bytes === 5242880});
  return {kind: 'SYNTHETIC_FEE_BROWSER_RECOVERY_CONTRACT_PROBE' as const, version: '0.1' as const, cases, wires, limits: FEE_BROWSER_RECOVERY_DESIGN_LIMITS,
    live_workbench_loaded: false as const, native_codec_implemented: false as const, financial_writes: 0 as const, import_authority: false as const, confirmation_authority: false as const, runtime_integrated: false as const};
}
