// Tiny DOM helper. Enough to build the app without a framework, small enough to
// read in one sitting.

/**
 * h('div', {class: 'row', onclick: fn}, child, child)
 *
 * - `class`/`className`, `style` (string or object), `dataset` (object)
 * - `on*` keys attach listeners
 * - anything else becomes an attribute, except that `value`, `checked` and
 *   `disabled` are set as properties so inputs behave
 * - children may be nodes, strings, numbers, arrays, or null/false (skipped)
 */
export function h(tag, props = null, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
        node[key] = value;
      } else node.setAttribute(key, value === true ? '' : value);
    }
  }
  append(node, children);
  return node;
}

export function svg(tag, props = null, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value);
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}
