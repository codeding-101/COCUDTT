/** Diagnostic UTF-8 counter, matching TextEncoder/Buffer replacement of isolated surrogates. No allocation of a full byte array. */
export function diagnosticUtf8Bytes(text: string, encoding = 'utf8'): number {
  if (typeof text !== 'string' || encoding !== 'utf8') throw Error('LAYERED_BROWSER_UTF8_INPUT');
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {bytes += 4; i++;}
    else bytes += 3;
  }
  return bytes;
}
