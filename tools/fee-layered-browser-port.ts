/** In-memory validation transform only. The committed Node codec and ordinary build remain unchanged. */
function once(code: string, from: string, to: string): string {
  if (code.split(from).length !== 2) throw Error('LAYERED_BROWSER_PORT_SOURCE_CHANGED');
  return code.replace(from, to);
}
const utf8Import = "import {diagnosticUtf8Bytes as utf8Layered95} from './fee-layered-browser-utf8.ts';\n";
export function transformFeeLayeredBrowserPort(source: string, id: string): {code: string; map: null} | null {
  const path = id.replaceAll('\\', '/'); let code = source;
  if (path.endsWith('/tools/fee-performance-size.ts')) return {code: utf8Import + once(code, "Buffer.byteLength(text, 'utf8')", "utf8Layered95(text, 'utf8')"), map: null};
  if (!path.endsWith('/tools/fee-layered-capture-prototype.ts')) return null;
  code = once(code, "import {createHash} from 'node:crypto';\n", '');
  code = once(code, "const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');",
    "const sha = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');");
  code = code.replaceAll('Buffer.byteLength(', 'utf8Layered95(');
  code = once(code, 'return {summary, materialize: () => {', 'return {summary, materialize: async () => {');
  code = once(code, 'retainedSha: sha(retainedJson), captureSha: sha(raw)', 'retainedSha: await sha(retainedJson), captureSha: await sha(raw)');
  code = once(code, 'function packet(input: FeeLayeredCaptureParts): FeeLayeredCapturePacket {', 'async function packet(input: FeeLayeredCaptureParts): Promise<FeeLayeredCapturePacket> {');
  code = code.replaceAll('restored = checked.materialize();', 'restored = await checked.materialize();');
  code = once(code, 'export function encodeFeeLayeredCapturePrototype(input: FeeLayeredCaptureParts): string {return JSON.stringify(packet(input));}', 'export async function encodeFeeLayeredCapturePrototype(input: FeeLayeredCaptureParts): Promise<string> {return JSON.stringify(await packet(input));}');
  code = once(code, 'export function decodeFeeLayeredCapturePrototype(wire: unknown): FeeLayeredCaptureRestoration {', 'export async function decodeFeeLayeredCapturePrototype(wire: unknown): Promise<FeeLayeredCaptureRestoration> {');
  code = once(code, 'const value = packet(parts);', 'const value = await packet(parts);');
  if (/\bBuffer\.|node:crypto|createHash\(/.test(code) || code.split('await checked.materialize()').length !== 3) throw Error('LAYERED_BROWSER_PORT_INCOMPLETE');
  return {code: utf8Import + code, map: null};
}
