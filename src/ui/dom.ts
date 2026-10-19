/** A tiny element builder; the interface uses no framework (CONTRIBUTING.md). */
export type Child = Node | string | null | false | undefined;

type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false || value === null) continue;
    if (name === 'class') element.className = String(value);
    else if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    } else if (name in element) (element as unknown as Props)[name] = value;
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === false || child === undefined) continue;
    element.append(child);
  }
  return element;
}
