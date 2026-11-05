import{inputPreservationQualifiedFingerprints,inputPreservationHistoricalBindings,historicalRuntime}from'./fee-input-preservation-evidence.mjs';
/** Actual source for the original mobile-panel contract, separate from immutable history. */
import {readFileSync, readdirSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const read = p => readFileSync(join(root, p));
const normalized = p => Buffer.from(read(p).toString('utf8').replace(/\r\n/g, '\n'));
const blob = b => createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
const priorFile = 'docs/cases/fee-component-session.json';
const prior = JSON.parse(read(priorFile));

export const mobileSettingsAddedPaths = [
  'tools/fee-mobile-settings-evidence.mjs',
  'tools/check-fee-mobile-settings.mjs',
  'tools/check-fee-mobile-settings-browser.mjs',
];
export const mobileSettingsChangedPaths = Object.fromEntries([
  'tools/fee-component-session-evidence.mjs',
  'tools/check-fee-component-session.mjs',
  'tools/fee-onboarding-evidence.mjs',
].map(p => [p, prior.source_fingerprints[p]]));
export const mobileSettingsHistoricalPins = {
  ...prior.historical_reports,
  [priorFile]: '20cb0a812ea4bf949c56887e4f529b319b8b3487',
};

export function mobileSettingsPaths() {
  const paths = [];
  function walk(dir) {
    for (const entry of readdirSync(join(root, dir), {withFileTypes: true})) {
      const p = dir + '/' + entry.name;
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.ts')) paths.push(p);
    }
  }
  for (const dir of ['src', 'tests']) walk(dir);
  for (const f of readdirSync(join(root, 'tools'))) {
    if (/\.(?:mjs|ts)$/.test(f)) paths.push('tools/' + f);
  }
  return paths.concat('package.json', 'package-lock.json').sort();
}

export function mobileSettingsFingerprints() {
  return Object.fromEntries(mobileSettingsPaths().map(p => [p, blob(normalized(p))]));
}

export function mobileSettingsQualifiedFingerprints() {
  for (const [p, hash] of Object.entries(mobileSettingsHistoricalPins)) {
    if (blob(normalized(p)) !== hash) throw Error('Historical mobile-panel evidence changed ' + p);
  }
  const actual = inputPreservationQualifiedFingerprints(), historical = inputPreservationHistoricalBindings(actual), completed = JSON.parse(read('docs/cases/fee-mobile-settings.json'));
  if (Object.keys(prior.source_fingerprints).length !== 694 ||
      JSON.stringify(Object.keys(completed.source_fingerprints)) !== JSON.stringify(Object.keys(prior.source_fingerprints).concat(mobileSettingsAddedPaths).sort())) {
    throw Error('Mobile-panel source inventory');
  }
  for (const [p, hash] of Object.entries(prior.source_fingerprints)) {
    if (!Object.hasOwn(mobileSettingsChangedPaths, p) && historical[p] !== hash) {
      throw Error('Original application/test/dependency changed ' + p);
    }
  }
  if (historicalRuntime().blob !== '3d1ab6e3413840b44e80de577956b0364343952c' ||
      createHash('sha256').update(read('docs/cases/fee-recovery-business-input.json')).digest('hex') !== '3c2be129eb846b336bb8aea7affcd92a12339e73dbcfe3942a93430934c90816') {
    throw Error('Original runtime or held archive changed');
  }
  return actual;
}

/** Only project an already-qualified actual map when checking completed older reports. */
export function mobileSettingsHistoricalBindings(value = mobileSettingsFingerprints()) {
  const actual = mobileSettingsQualifiedFingerprints();
  if (JSON.stringify(value) !== JSON.stringify(actual)) throw Error('Actual mobile-panel source required');
  return {...inputPreservationHistoricalBindings(actual), ...mobileSettingsChangedPaths};
}
