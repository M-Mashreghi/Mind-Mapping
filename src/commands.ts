import { Editor } from './editor';
import { isClaim, isGroup } from './model/types';
import { platform } from './platform/platform';

export interface Command {
  id: string;
  label: string;
  /** Display form, e.g. "Ctrl+Shift+Z". */
  shortcut?: string;
  run: (ed: Editor) => void;
  enabled?: (ed: Editor) => boolean;
  checked?: (ed: Editor) => boolean;
}

const hasSelection = (ed: Editor) => ed.selection.length > 0;
const primaryIsClaim = (ed: Editor) => isClaim(ed.doc.get(ed.primary));
const primaryIsClaimOrGroup = (ed: Editor) => !!ed.primary;
const selectionHasPremise = (ed: Editor) =>
  ed.selection.some((id) => {
    const n = ed.doc.get(id);
    return isClaim(n) && n!.parent !== null;
  });
const selectionHasGroup = (ed: Editor) =>
  ed.selection.some((id) => {
    const n = ed.doc.get(id);
    return isGroup(n) || isGroup(ed.doc.get(n?.parent));
  });
const selectionHasChildren = (ed: Editor) =>
  ed.selection.some((id) => isClaim(ed.doc.get(id)) && ed.doc.children(id).length > 0);

const list: Command[] = [
  // File
  { id: 'file.new', label: 'New argument map', shortcut: 'Ctrl+N', run: (ed) => void ed.newMap() },
  { id: 'file.open', label: 'Open…', shortcut: 'Ctrl+O', run: (ed) => void ed.open() },
  { id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', run: (ed) => void ed.save() },
  { id: 'file.saveAs', label: 'Save as…', shortcut: 'Ctrl+Shift+S', run: (ed) => void ed.save(true) },
  {
    id: 'file.rename',
    label: 'Rename…',
    run: (ed) => {
      const t = window.prompt('Map title', ed.doc.title);
      if (t !== null) ed.rename(t);
    },
  },

  // Edit
  { id: 'edit.undo', label: 'Undo', shortcut: 'Ctrl+Z', run: (ed) => ed.undo(), enabled: (ed) => ed.doc.undo.canUndo() },
  { id: 'edit.redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', run: (ed) => ed.redo(), enabled: (ed) => ed.doc.undo.canRedo() },
  {
    id: 'edit.cut', label: 'Cut', shortcut: 'Ctrl+X', enabled: hasSelection,
    run: (ed) => {
      const t = ed.cut();
      if (t) void navigator.clipboard?.writeText(t).catch(() => {});
    },
  },
  {
    id: 'edit.copy', label: 'Copy', shortcut: 'Ctrl+C', enabled: hasSelection,
    run: (ed) => {
      const t = ed.copyText();
      if (t) void navigator.clipboard?.writeText(t).catch(() => {});
    },
  },
  { id: 'edit.paste', label: 'Paste as child', shortcut: 'Ctrl+V', run: (ed) => void ed.pasteFromMenu(false) },
  { id: 'edit.pasteRoot', label: 'Paste as root node', shortcut: 'Ctrl+Shift+V', run: (ed) => void ed.pasteFromMenu(true) },
  { id: 'edit.text', label: 'Edit text', shortcut: 'Space', run: (ed) => ed.startEditing(), enabled: primaryIsClaim },
  { id: 'edit.selectSubtree', label: 'Select subtree', run: (ed) => ed.selectSubtree(), enabled: hasSelection },
  { id: 'edit.selectChildren', label: 'Select children', run: (ed) => ed.selectChildren(), enabled: hasSelection },
  { id: 'edit.selectSiblings', label: 'Select siblings', run: (ed) => ed.selectSiblings(), enabled: hasSelection },
  { id: 'edit.selectAll', label: 'Select all', shortcut: 'Ctrl+A', run: (ed) => ed.selectAll() },
  { id: 'edit.clearSelection', label: 'Clear selection', shortcut: 'Esc', run: (ed) => ed.clearSelection(), enabled: hasSelection },
  {
    id: 'edit.implicit', label: 'Toggle implicit claim', shortcut: 'Alt+T', run: (ed) => ed.toggleImplicit(),
    enabled: (ed) => ed.selection.some((id) => isClaim(ed.doc.get(id))),
    checked: (ed) => !!ed.primary && !!ed.doc.get(ed.primary)?.implicit,
  },
  { id: 'edit.toReason', label: 'Make it a reason', run: (ed) => ed.convertGroup('reason'), enabled: selectionHasGroup },
  { id: 'edit.toObjection', label: 'Make it an objection', run: (ed) => ed.convertGroup('objection'), enabled: selectionHasGroup },
  { id: 'edit.detach', label: 'Detach node', shortcut: 'D', run: (ed) => ed.detach(), enabled: selectionHasPremise },
  { id: 'edit.resetPosition', label: 'Reset node position', run: (ed) => ed.resetPosition(), enabled: hasSelection },
  { id: 'edit.delete', label: 'Delete', shortcut: 'Delete', run: (ed) => ed.deleteSelection(), enabled: hasSelection },

  // Insert
  { id: 'insert.reason', label: 'Reason', shortcut: 'Alt+S', run: (ed) => ed.addReason(), enabled: primaryIsClaimOrGroup },
  { id: 'insert.objection', label: 'Objection', shortcut: 'Alt+O', run: (ed) => ed.addObjection(), enabled: primaryIsClaimOrGroup },
  { id: 'insert.child', label: 'Child claim', shortcut: 'Enter', run: (ed) => ed.addChild(), enabled: primaryIsClaimOrGroup },
  { id: 'insert.sibling', label: 'Sibling claim (co-premise)', shortcut: 'Tab', run: (ed) => ed.addSibling(), enabled: primaryIsClaimOrGroup },
  { id: 'insert.parent', label: 'Parent claim', shortcut: 'Shift+Enter', run: (ed) => ed.addParent(), enabled: primaryIsClaim },
  { id: 'insert.root', label: 'Root node', shortcut: 'Ctrl+D', run: (ed) => ed.addRoot() },

  // View
  { id: 'view.fold', label: 'Fold / unfold', shortcut: 'F', run: (ed) => ed.toggleFold(), enabled: selectionHasChildren },
  { id: 'view.foldLevel', label: 'Fold one level', shortcut: 'Alt+F', run: (ed) => ed.foldOneLevel() },
  { id: 'view.unfoldLevel', label: 'Unfold one level', shortcut: 'Shift+F', run: (ed) => ed.unfoldOneLevel() },
  { id: 'view.foldAll', label: 'Fold all', run: (ed) => ed.foldAll(true) },
  { id: 'view.unfoldAll', label: 'Unfold all', run: (ed) => ed.foldAll(false) },
  { id: 'view.grid', label: 'Show grid', run: (ed) => ed.toggleGrid(), checked: (ed) => ed.showGrid },
  {
    id: 'view.comfortable', label: 'Comfortable spacing',
    run: (ed) => ed.setDensity(ed.density === 'compact' ? 'comfortable' : 'compact'),
    checked: (ed) => ed.density === 'comfortable',
  },
  { id: 'view.zoomIn', label: 'Zoom in', shortcut: 'Ctrl++', run: (ed) => ed.zoomAt(1.2) },
  { id: 'view.zoomOut', label: 'Zoom out', shortcut: 'Ctrl+-', run: (ed) => ed.zoomAt(1 / 1.2) },
  { id: 'view.fit', label: 'Zoom to fit', shortcut: 'Ctrl+1', run: (ed) => ed.zoomToFit() },
  { id: 'view.recenter', label: 'Recenter', shortcut: 'Ctrl+0', run: (ed) => ed.recenter() },
  { id: 'view.fullscreen', label: 'Full screen', shortcut: 'F11', run: () => platform.toggleFullScreen() },

  // Help
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', shortcut: 'Ctrl+/', run: () => window.dispatchEvent(new CustomEvent('argmap:shortcuts')) },
  { id: 'help.about', label: 'About Argument Mapper', run: () => window.dispatchEvent(new CustomEvent('argmap:about')) },
  {
    id: 'help.source', label: 'Source code on GitHub',
    run: () => platform.openExternal('https://github.com/M-Mashreghi/Mind-Mapping'),
  },
];

export const commands = new Map(list.map((c) => [c.id, c]));

export function cmd(id: string): Command {
  const c = commands.get(id);
  if (!c) throw new Error(`Unknown command ${id}`);
  return c;
}

export type MenuItem = string | '-' | { label: string; items: MenuItem[] };

export const menus: { label: string; items: MenuItem[] }[] = [
  { label: 'File', items: ['file.new', 'file.open', { label: 'Open recent', items: [] }, '-', 'file.save', 'file.saveAs', '-', 'file.rename'] },
  {
    label: 'Edit',
    items: [
      'edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.pasteRoot', '-', 'edit.text',
      { label: 'Select', items: ['edit.selectSubtree', 'edit.selectChildren', 'edit.selectSiblings', 'edit.selectAll', 'edit.clearSelection'] },
      '-', 'edit.implicit', 'edit.toReason', 'edit.toObjection', 'edit.detach', 'edit.resetPosition', '-', 'edit.delete',
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Fold / unfold', items: ['view.fold', 'view.foldLevel', 'view.unfoldLevel', 'view.foldAll', 'view.unfoldAll'] },
      'view.grid', 'view.comfortable', '-', 'view.zoomIn', 'view.zoomOut', 'view.fit', 'view.recenter', '-', 'view.fullscreen',
    ],
  },
  { label: 'Insert', items: ['insert.reason', 'insert.objection', '-', 'insert.child', 'insert.sibling', 'insert.parent', '-', 'insert.root'] },
  { label: 'Help', items: ['help.shortcuts', 'help.about', 'help.source'] },
];

export const nodeContextMenu: MenuItem[] = [
  'insert.reason', 'insert.objection', 'insert.child', 'insert.sibling', 'insert.parent', '-',
  'edit.text', 'edit.implicit', 'edit.toReason', 'edit.toObjection', '-',
  'edit.cut', 'edit.copy', 'edit.paste', '-',
  'view.fold', 'edit.selectSubtree', '-', 'edit.detach', 'edit.resetPosition', 'edit.delete',
];

export const canvasContextMenu: MenuItem[] = [
  'edit.pasteRoot', 'insert.root', '-', 'view.grid', 'view.foldAll', 'view.unfoldAll', '-', 'edit.selectAll', 'view.fit',
];

/** Map a keyboard event to a command id (when no text is being edited). */
export function commandForKey(e: KeyboardEvent): string | null {
  const mod = e.ctrlKey || e.metaKey;
  const { shiftKey: shift, altKey: alt, code, key } = e;
  if (mod && !alt) {
    if (code === 'KeyZ') return shift ? 'edit.redo' : 'edit.undo';
    if (code === 'KeyY') return 'edit.redo';
    if (code === 'KeyN') return 'file.new';
    if (code === 'KeyO') return 'file.open';
    if (code === 'KeyS') return shift ? 'file.saveAs' : 'file.save';
    if (code === 'KeyA') return 'edit.selectAll';
    if (code === 'KeyD') return 'insert.root';
    if (code === 'Equal' || code === 'NumpadAdd' || key === '+') return 'view.zoomIn';
    if (code === 'Minus' || code === 'NumpadSubtract') return 'view.zoomOut';
    if (code === 'Digit1') return 'view.fit';
    if (code === 'Digit0') return 'view.recenter';
    if (code === 'Slash') return 'help.shortcuts';
    return null;
  }
  if (alt && !mod) {
    if (code === 'KeyS') return 'insert.reason';
    if (code === 'KeyO') return 'insert.objection';
    if (code === 'KeyT') return 'edit.implicit';
    if (code === 'KeyF') return 'view.foldLevel';
    return null;
  }
  if (mod) return null;
  if (key === 'Enter') return shift ? 'insert.parent' : 'insert.child';
  if (key === 'Tab' && !shift) return 'insert.sibling';
  if (key === 'Delete' || key === 'Backspace') return 'edit.delete';
  if (key === 'Escape') return 'edit.clearSelection';
  if (key === ' ' || key === 'F2') return 'edit.text';
  if (key === 'F11') return 'view.fullscreen';
  if (code === 'KeyF') return shift ? 'view.unfoldLevel' : 'view.fold';
  if (code === 'KeyD' && !shift) return 'edit.detach';
  return null;
}
