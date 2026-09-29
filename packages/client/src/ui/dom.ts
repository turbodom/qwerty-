/** Tiny DOM helpers. Text always goes through textContent (player names come from the network). */

export type Child = Node | string | number | null | undefined | false;

export interface Attrs {
  class?: string;
  id?: string;
  type?: string;
  title?: string;
  disabled?: boolean;
  hidden?: boolean;
  src?: string;
  alt?: string;
  placeholder?: string;
  value?: string;
  maxLength?: number;
  autocomplete?: string;
  role?: string;
  ariaLabel?: string;
  testid?: string;
  style?: string;
  onClick?: (ev: MouseEvent) => void;
  onInput?: (ev: Event) => void;
  onKeydown?: (ev: KeyboardEvent) => void;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    if (attrs.class) el.className = attrs.class;
    if (attrs.id) el.id = attrs.id;
    if (attrs.type) el.setAttribute("type", attrs.type);
    if (attrs.title) el.title = attrs.title;
    if (attrs.disabled) el.setAttribute("disabled", "");
    if (attrs.hidden) el.hidden = true;
    if (attrs.src) el.setAttribute("src", attrs.src);
    if (attrs.alt !== undefined) el.setAttribute("alt", attrs.alt);
    if (attrs.placeholder) el.setAttribute("placeholder", attrs.placeholder);
    if (attrs.value !== undefined) (el as unknown as HTMLInputElement).value = attrs.value;
    if (attrs.maxLength !== undefined) el.setAttribute("maxlength", String(attrs.maxLength));
    if (attrs.autocomplete) el.setAttribute("autocomplete", attrs.autocomplete);
    if (attrs.role) el.setAttribute("role", attrs.role);
    if (attrs.ariaLabel) el.setAttribute("aria-label", attrs.ariaLabel);
    if (attrs.testid) el.dataset["testid"] = attrs.testid;
    if (attrs.style) el.setAttribute("style", attrs.style);
    if (attrs.onClick) el.addEventListener("click", attrs.onClick as EventListener);
    if (attrs.onInput) el.addEventListener("input", attrs.onInput);
    if (attrs.onKeydown) el.addEventListener("keydown", attrs.onKeydown as EventListener);
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: (Child | Child[])[]): void {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c);
    else if (c === null || c === undefined || c === false) continue;
    else if (typeof c === "string" || typeof c === "number") el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}
