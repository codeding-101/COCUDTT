/** CDP navigation acknowledgement precedes document replacement. Never inspect stale DOM. */
export function withDocumentNavigation(send) {
  let serial = 0;
  return async (method, params = {}) => {
    if (method !== 'Page.navigate' && method !== 'Page.reload') return send(method, params);
    const marker = '__browserDocumentBeforeNavigation', token = String(++serial);
    const before = await send('Runtime.evaluate', {expression: `window.${marker}=${JSON.stringify(token)}`});
    if (before.exceptionDetails) throw Error('Cannot mark current browser document');
    const result = await send(method, params);
    if (result.errorText) throw Error('Browser navigation failed: ' + result.errorText);
    // A same-document hash change has no new loader; no document replacement occurs.
    if (method === 'Page.navigate' && !result.loaderId) return result;
    for (let i = 0; i < 300; i++) {
      try {
        const ready = await send('Runtime.evaluate', {expression: `window.${marker}!==${JSON.stringify(token)}&&document.readyState==='complete'`, returnByValue: true});
        if (!ready.exceptionDetails && ready.result.value === true) return result;
      } catch (error) {
        if (!/Execution context.*destroy|Cannot find context|Inspected target navigated or closed|Cannot find default execution context/i.test(String(error))) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Timed out waiting for the new browser document');
  };
}
