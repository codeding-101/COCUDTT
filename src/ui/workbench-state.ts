/** Runtime ownership only. Values remain legacy objects; this is not a JSON or financial validation API. */
export interface WorkbenchCheckpoint {readonly scope: 'WORKBENCH_OWNER_CHECKPOINT'; readonly revision: number}
export interface WorkbenchUpdate {target: object; values: Record<string, unknown>}
export interface WorkbenchPreparation extends WorkbenchUpdate {advance: readonly string[]}
type Fields = Readonly<Record<string, unknown>>;
type Root = Readonly<Record<string, Fields>>;
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
function fail(reason: string): never {throw Error('WORKBENCH_STATE_' + reason);}
/** Read only own data descriptors; never invoke a caller-supplied getter or toJSON. */
function ownFields(value: object): Record<string, unknown> {
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || reserved.has(key)) fail('FIELD');
    const d = descriptors[key]!; if (!d.enumerable || !('value' in d)) fail('ACCESSOR');
    result[key] = d.value;
  }
  return result;
}

/**
 * Routes existing controller fields through one root. No storage, rendering, notifications or automatic application.
 * Nested legacy edits still require touch() at interaction boundaries; checkpoints are not immutable data snapshots.
 */
export class WorkbenchStateOwner {
  private root: Root = Object.freeze({});
  private revision = 0;
  private readonly targets = new WeakMap<object, string>();
  private readonly issued = new WeakMap<object, {root: Root; revision: number}>();
  private advance() {if (this.revision === Number.MAX_SAFE_INTEGER) fail('REVISION_LIMIT'); this.revision++;}
  bind(target: object, name: string): void {
    if (typeof name !== 'string' || !name || reserved.has(name) || Object.hasOwn(this.root, name) || this.targets.has(target)) fail('DUPLICATE_OWNER');
    const descriptors = Object.getOwnPropertyDescriptors(target), fields: Record<string, unknown> = {}, forward: PropertyDescriptorMap = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === 'env' || key === 'controller') continue; // Stable controller/environment identity is not mutable state.
      if (typeof key !== 'string' || reserved.has(key)) fail('FIELD');
      const d = descriptors[key]!;
      if (!('value' in d) || !d.configurable || !d.writable || !d.enumerable) fail('UNBINDABLE_FIELD');
      fields[key] = d.value;
      forward[key] = {enumerable: true, configurable: false,
        get: () => this.root[name]![key],
        set: (value: unknown) => {const next = Object.freeze({...this.root, [name]: Object.freeze({...this.root[name]!, [key]: value})}); this.advance(); this.root = next;},
      };
    }
    if (!Object.keys(fields).length) fail('EMPTY_OWNER');
    const next = Object.freeze({...this.root, [name]: Object.freeze(fields)});
    if (this.revision === Number.MAX_SAFE_INTEGER) fail('REVISION_LIMIT');
    Object.defineProperties(target, forward); this.advance(); this.root = next; this.targets.set(target, name);
  }
  touch(): void {this.advance();}
  checkpoint(): WorkbenchCheckpoint {
    const token = Object.freeze({scope: 'WORKBENCH_OWNER_CHECKPOINT' as const, revision: this.revision});
    this.issued.set(token, {root: this.root, revision: this.revision}); return token;
  }
  isCurrent(token: WorkbenchCheckpoint): boolean {const c = this.issued.get(token); return !!c && c.root === this.root && c.revision === this.revision;}
  /** Prepare trusted patches and cancellation epochs without replacing any running state. */
  prepareUpdates(updates: readonly WorkbenchPreparation[]) {
    const token = this.checkpoint(), targets = new Set<string>(), order: string[] = [], prepared: WorkbenchUpdate[] = [];
    if (!Array.isArray(updates) || !updates.length || updates.length > 100) fail('UPDATES');
    const list = Object.getOwnPropertyDescriptors(updates);
    if (Reflect.ownKeys(list).length !== updates.length + 1) fail('UPDATES');
    for (let i = 0; i < updates.length; i++) {
      const d = list[String(i)]; if (!d?.enumerable || !('value' in d)) fail('ACCESSOR');
      const update = ownFields(d.value as object);
      if (Object.keys(update).sort().join('|') !== 'advance|target|values') fail('UPDATE_SHAPE');
      const name = this.targets.get(update.target as object); if (!name || targets.has(name)) fail('TARGET');
      const fields = this.root[name]!, values = ownFields(update.values as object);
      if (!Array.isArray(update.advance) || update.advance.length > 100) fail('ADVANCE');
      const keys = Object.getOwnPropertyDescriptors(update.advance);
      if (Reflect.ownKeys(keys).length !== update.advance.length + 1) fail('ADVANCE');
      const seen = new Set<string>();
      for (let j = 0; j < update.advance.length; j++) {
        const field = keys[String(j)]; if (!field?.enumerable || !('value' in field) || typeof field.value !== 'string') fail('ACCESSOR');
        const key = field.value, value = fields[key];
        if (seen.has(key) || Object.hasOwn(values, key) || !Object.hasOwn(fields, key) || !Number.isSafeInteger(value) || (value as number) < 0 || value === Number.MAX_SAFE_INTEGER) fail('ADVANCE');
        seen.add(key); values[key] = (value as number) + 1;
      }
      targets.add(name); order.push(name);
      if (Object.keys(values).some(key => !Object.hasOwn(fields, key))) fail('UNKNOWN_FIELD');
      if (!Object.keys(values).length) fail('EMPTY_UPDATE');
      prepared.push(Object.freeze({target: update.target as object, values: Object.freeze(values)}));
    }
    if (!this.isCurrent(token)) fail('STALE_PREPARATION');
    return Object.freeze({scope: 'WORKBENCH_PREPARED_UPDATES' as const, participants: Object.freeze([...targets].sort()), order: Object.freeze(order), updates: Object.freeze(prepared)});
  }
  /** Trusted, already prepared field replacements. Caller must validate all financial and source semantics first. */
  commit(token: WorkbenchCheckpoint, updates: readonly WorkbenchUpdate[]): boolean {
    if (!this.isCurrent(token)) return false;
    if (!Array.isArray(updates) || !updates.length || updates.length > 100) fail('UPDATES');
    const list = Object.getOwnPropertyDescriptors(updates);
    if (Reflect.ownKeys(list).length !== updates.length + 1) fail('UPDATES');
    let next: Root = this.root; const changed = new Set<string>();
    for (let i = 0; i < updates.length; i++) {
      const d = list[String(i)]; if (!d?.enumerable || !('value' in d)) fail('ACCESSOR');
      const update = ownFields(d.value as object);
      if (Object.keys(update).length !== 2 || !Object.hasOwn(update, 'target') || !Object.hasOwn(update, 'values')) fail('UPDATE_SHAPE');
      const name = this.targets.get(update.target as object); if (!name || changed.has(name)) fail('TARGET');
      const values = ownFields(update.values as object), fields = this.root[name]!;
      if (!Object.keys(values).length || Object.keys(values).some(key => !Object.hasOwn(fields, key))) fail('UNKNOWN_FIELD');
      changed.add(name); next = Object.freeze({...next, [name]: Object.freeze({...fields, ...values})});
    }
    // Descriptor traps can reenter. All targets and fields must still belong to the captured revision.
    if (!this.isCurrent(token)) return false;
    this.advance(); this.root = next; return true;
  }
  status() {return Object.freeze({scope: 'RUNTIME_WORKBENCH_STATE_OWNER' as const, revision: this.revision,
    participants: Object.freeze(Object.keys(this.root).sort()), fields: Object.values(this.root).reduce((n, fields) => n + Object.keys(fields).length, 0),
    fee_application_entry: false as const});}
}
