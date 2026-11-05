// The FileList identity records handoff to an existing reader, not a saved file.
// Weak keys release this UI metadata with the replaced input node.
const consumedSelections = new WeakMap<HTMLInputElement, FileList>();
export function takeSelectedFile(input: HTMLInputElement): File | undefined {
  const files = input.files, file = files?.[0];
  if (files && file) { consumedSelections.set(input, files); input.value = ''; }
  return file;
}

/** Install rendered markup without cloning selected files or assigning a fake file path. */
export function replaceWorkspaceMarkup(root: HTMLElement, markup: string, preserveFiles: boolean): void {
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = markup;
  const selected = preserveFiles
    ? [...root.querySelectorAll<HTMLInputElement>('input[type="file"]')].filter(input => {
      const files = input.files;
      return (files?.length ?? 0) > 0 && consumedSelections.get(input) !== files;
    })
    : [];
  const attributes = (element: Element): string => JSON.stringify(
    element.getAttributeNames().sort().map(name => [name, element.getAttribute(name)]));
  const ids = new Map<string, Element[]>();
  for (const element of template.content.querySelectorAll('[id]')) {
    const matches = ids.get(element.id) ?? []; matches.push(element); ids.set(element.id, matches);
  }
  // Preflight every target before removing any original input. A changed owner or
  // incompatible template must not silently discard an unprocessed selection.
  const seen = new Set<string>();
  const moves = selected.map(input => {
    const targets = ids.get(input.id) ?? [], target = targets[0];
    if (!input.id || seen.has(input.id) || targets.length !== 1 ||
        !(target instanceof HTMLInputElement) || target.type !== 'file' || attributes(input) !== attributes(target)) {
      throw Error('已选文件输入与新界面不匹配，请先完成读取或明确取消选择');
    }
    seen.add(input.id);
    return {input, target, parent: input.parentNode!, next: input.nextSibling};
  });
  try {
    for (const move of moves) move.target.replaceWith(move.input);
    root.replaceChildren(template.content);
  } catch (error) {
    for (const move of [...moves].reverse()) {
      if (move.input.parentNode !== move.parent) {
        move.parent.insertBefore(move.input, move.next?.parentNode === move.parent ? move.next : null);
      }
    }
    throw error;
  }
}
