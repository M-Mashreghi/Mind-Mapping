# Argument Mapper

Free, open-source argument mapping for the desktop. Lay out a claim, the reasons that
support it and the objections against it, with co-premises, hidden assumptions and
nested rebuttals, then share the map with people on your network.

> Status: early development. Phase 1 (the core editor) is in place. See the
> [roadmap](docs/ROADMAP.md) for what comes next: styling and export, Windows/Linux
> installers, live LAN collaboration and Google Drive.

## Features (phase 1)

- Claims, **reasons** (green) and **objections** (red); several premises in one reason are co-premises
- Implicit (unstated) claims drawn with a dashed border
- Automatic top-down layout, drag to nudge, drag onto a claim or reason to restructure
- Fold and unfold branches, zoom, pan, grid
- Undo/redo, cut/copy/paste of whole branches (plain text pastes as claims)
- Right-to-left text such as Persian or Arabic works in any box
- Open and save `.amap` files (readable JSON); autosave on the desktop, draft recovery in the browser

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Add reason / objection | Alt+S / Alt+O |
| Child claim / sibling (co-premise) / parent | Enter / Tab / Shift+Enter |
| New root claim | Ctrl+D |
| Edit text | Space, F2, double-click or just start typing |
| Toggle implicit claim | Alt+T |
| Detach from parent | D |
| Fold / fold one level / unfold one level | F / Alt+F / Shift+F |
| Zoom in / out / fit / recenter | Ctrl++ / Ctrl+- / Ctrl+1 / Ctrl+0 |
| Move selection | Arrow keys |

The full list is under **Help → Keyboard shortcuts** (Ctrl+/).

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # editor in the browser at http://localhost:5173
npm start          # build and run the desktop app (Electron)
npm test           # unit tests
npm run typecheck
```

### Project layout

| Path | What lives there |
| --- | --- |
| `src/model` | The map document (Yjs), file format |
| `src/layout` | Tree layout and text measuring |
| `src/editor.ts` | Editor state and every editing command |
| `src/commands.ts` | Menus, context menus and keyboard shortcuts |
| `src/ui` | React components (canvas, menus, dialogs) |
| `src/platform` | Desktop vs. browser file access |
| `electron` | Electron main and preload scripts |

## Licence

MIT. See [LICENSE](LICENSE).
