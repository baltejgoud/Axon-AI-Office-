import { useEffect, useRef } from 'react';

const stack: (() => void)[] = [];
let bound = false;

/** Registers an Esc handler; only the most recently registered one runs. Returns an unregister function. */
export function pushEscape(handler: () => void): () => void {
  if (!bound) {
    bound = true;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && stack.length) {
        event.preventDefault();
        stack[stack.length - 1]();
      }
    });
  }
  stack.push(handler);
  return () => {
    const index = stack.lastIndexOf(handler);
    if (index >= 0) stack.splice(index, 1);
  };
}

/** Esc runs `handler` while this component is the topmost registered layer. */
export function useEscape(handler: () => void, active = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return pushEscape(() => ref.current());
  }, [active]);
}
