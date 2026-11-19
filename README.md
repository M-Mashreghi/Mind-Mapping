# Argument Mapper

Free, open-source argument mapping for the desktop. Lay out a claim, the reasons that
support it and the objections against it, with co-premises, hidden assumptions and
nested rebuttals, then share the map with people on your network.

> Status: early development. The editor, styling, notes, export, Windows/Linux
> installers and live LAN collaboration are in place. See the [roadmap](docs/ROADMAP.md)
> for what comes next: Google Drive, presenting and more.

## Download

Installers are built by GitHub Actions for every release:

- **Windows:** `Argument-Mapper-Setup-<version>.exe` (installer) or `Argument-Mapper-Portable-<version>.exe` (no install needed)
- **Linux:** `Argument-Mapper-<version>-x86_64.AppImage` (make it executable and run it) or `Argument-Mapper-<version>-amd64.deb` (`sudo apt install ./Argument-Mapper-*.deb`)

Windows may show a SmartScreen warning the first time because the app is not code-signed; choose **More info → Run anyway**.

`.amap` files open in the app when you double-click them after installing.

## Features

- Claims, **reasons** (green) and **objections** (red); several premises in one reason are co-premises
- Implicit (unstated) claims drawn with a dashed border
- Automatic top-down layout, drag to nudge, drag onto a claim or reason to restructure
- Fold and unfold branches, zoom, pan, grid
- Undo/redo, cut/copy/paste of whole branches (plain text pastes as claims)
- Right-to-left text such as Persian or Arabic works in any box
- Open and save `.amap` files (readable JSON); autosave on the desktop, draft recovery in the browser
- Per-box style: fill, border and text colour, font size, bold/italic/underline/strike, alignment, lists, links
- Map theme: high-impact style, density, reason/objection/root colours, bundled fonts (including Vazirmatn for Persian), borders, corners, shadows, line style; light and dark mode
- Numbering labels (by level, hierarchical, sequential)
- Notes on any box, a notes panel with search, sticky notes, dashed connections between any two boxes (Alt+Click)
- Find (Ctrl+F) across box text and notes
- Export to PNG, SVG, PDF, Markdown or plain-text outline, and notes; import MindMup `.mup` files
- Version history kept inside the map file, with one-click restore
- **Work together on your local network**: one person shares the map from the desktop app,
  others join from the app or from any browser; live edits, cursors and selections,
  view-only guests, comments and emoji reactions on boxes

## Working together on a local network

No internet or account is needed. Everyone must be on the same Wi-Fi or office network.

1. The host opens the map in the desktop app and chooses **Share** (top right) → **Start sharing**.
   The app shows an address such as `192.168.1.20:47821` and two codes: one that can edit and
   one that can only view.
2. Others either
   - open the desktop app, choose **Share**, pick the map from the list of maps found on the
     network (or type the address) and enter the code, or
   - open the link the host copied, for example `http://192.168.1.20:47821/?join=KSKE26`, in
     any browser. Nothing has to be installed.
3. Everyone sees each other's changes, mouse pointers and selected boxes as they happen. Select a
   box and use ☺ in its toolbar to react, or open **Notes** (N) to read and write comments.

The map stays a file on the host's computer and keeps saving there. When a guest leaves, they
keep a copy they can save. If the connection drops, changes are kept and sync again when it's
back. The first time you share, Windows may ask whether to allow the app on private networks;
choose **Allow**. On Linux, open TCP port 47821 if a firewall is running
(for example `sudo ufw allow 47821/tcp`).

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Add reason / objection | Alt+S / Alt+O |
| Child claim / sibling (co-premise) / parent | Enter / Tab / Shift+Enter |
| New root claim | Ctrl+D |
| Edit text | Space, F2, double-click or just start typing |
| Toggle implicit claim | Alt+T |
| Sticky note / connection | Alt+N / Alt+Click |
| Note / notes panel / link | N / Shift+N / Ctrl+K |
| Bold / italic / underline / strike | Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+Shift+X |
| Larger / smaller text | T / Shift+T |
| Copy / paste style | Ctrl+Alt+C / Ctrl+Alt+V |
| Find | Ctrl+F |
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
npm run dist:linux # AppImage + .deb in release/
npm run dist:win   # Windows installer + portable .exe (build on Windows)
```

To build installers in the cloud, open **Actions → Build desktop apps → Run workflow**; the
files appear as downloadable artifacts. Pushing a tag such as `v0.2.0` also attaches them
to a GitHub Release.

### Project layout

| Path | What lives there |
| --- | --- |
| `src/model` | The map document (Yjs), file format |
| `src/layout` | Tree layout and text measuring |
| `src/editor.ts` | Editor state and every editing command |
| `src/commands.ts` | Menus, context menus and keyboard shortcuts |
| `src/ui` | React components (canvas, menus, toolbars, panels, dialogs) |
| `src/export` | SVG/PNG/PDF rendering and outline export |
| `src/theme.ts` | Fonts, sizes and how styles turn into CSS |
| `src/platform` | Desktop vs. browser file access |
| `src/collab` | Joining a shared map: connection, presence |
| `electron` | Electron main and preload scripts, LAN collaboration server |

## Licence

MIT. See [LICENSE](LICENSE).
