import {describe, expect, it} from 'vitest';
import {mount} from '../src/mount.js';

function fakeElement(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    dataset: {},
    children: [] as unknown[],
    textContent: '',
    append(...children: unknown[]) {
      this.children.push(...children);
    },
    replaceChildren(...children: unknown[]) {
      this.children = children;
    },
    addEventListener() {},
    removeEventListener() {},
  };
}

describe('Marble Works mount contract', () => {
  it('returns synchronously and tolerates repeated disposal', () => {
    const host = {
      signal: new AbortController().signal,
      ui: {make: (tag: string) => fakeElement(tag)},
      storage: {},
    };
    const result = mount(host as never, {autostart: false});
    expect(result.element).toBeDefined();
    result.dispose();
    result.dispose();
  });
});
