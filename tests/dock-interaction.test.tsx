// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { Editor } from '../src/editor';

it('lets a focused Add button receive Enter and inserts a reason through its menu', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  try {
    const { App } = await import('../src/App');
    const editor = (window as unknown as { argmapEditor: Editor }).argmapEditor;
    await act(async () => root.render(<App />));
    const add = host.querySelector<HTMLButtonElement>('button[aria-label="Add to map"]')!;
    add.focus();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => { add.dispatchEvent(enter); });
    expect(enter.defaultPrevented).toBe(false);
    await act(async () => add.click());
    const items = Array.from(host.querySelectorAll<HTMLButtonElement>('.dock [role="menuitem"]'));
    const reason = items.find(item => item.textContent?.includes('supports the claim'))!;
    expect(reason).toBeDefined();
    if (reason.disabled) {
      await act(async () => items.find(item => item.textContent?.includes('Independent claim'))!.click());
      await act(async () => add.click());
    }
    const count = editor.doc.all().filter(node => node.kind === 'reason').length;
    await act(async () => host.querySelectorAll<HTMLButtonElement>('.dock [role="menuitem"]')[1].click());
    expect(editor.doc.all().filter(node => node.kind === 'reason')).toHaveLength(count + 1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
