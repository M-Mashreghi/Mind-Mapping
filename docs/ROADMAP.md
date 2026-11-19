# Roadmap

Each phase ships as its own pull request.

## Phase 1: core argument-map editor ✅

- Electron + React + TypeScript + Vite project, tests, MIT licence
- Data model on Yjs: claims, reason and objection groups, co-premises, implicit claims, free root nodes
- Top-down layout with group boxes around co-premises and support/oppose arrows
- Canvas: pan, zoom, fit, recenter, grid
- All Insert-menu actions with familiar shortcuts, inline editing, delete, detach, drag to move/restructure
- Selection, cut/copy/paste, undo/redo, fold/unfold
- Open/save `.amap` files, autosave, recent files
- Right-to-left text

## Phase 2: styling, notes and export ✅

- Node toolbar: fill, border, shape, font, size, text style, alignment, lists, links
- Theme panel: map style, density, support/objection colours, root overrides, fonts, borders, lines, dark mode
- Node numbering (sequence by level, hierarchical, sequential)
- Notes per node and a notes panel with search and export
- Sticky notes, image nodes, file attachments, connections between any two nodes
- Find (Ctrl+F)
- Export PNG, SVG, PDF, outline (text/Markdown), notes; import MindMup `.mup` files
- Version history stored in the file

## Phase 3: desktop packaging ✅

- File associations for `.amap`, open from the command line
- Windows installer and Linux AppImage + .deb via electron-builder
- GitHub Actions release workflow

## Phase 4: LAN collaboration

- "Host this map" runs a WebSocket server inside the app and shows an address and join code
- "Join" discovers hosts on the network (mDNS) or takes an address
- Live sync with Yjs, collaborator cursors and selections
- Guests can join from a plain browser served by the host
- Comments and emoji reactions on nodes; optional read-only guests

## Phase 5: Google Drive

- Sign in with Google (desktop OAuth with PKCE, `drive.file` scope)
- Open from Drive, save to Drive, autosave back to Drive, conflict handling

## Phase 6: beyond the usual tools

- Presentation mode that steps through an argument branch by branch
- Argument evaluation: rate premises and reasons, see the computed strength on the map
- Templates and read-only HTML export for sharing
