# Argument Mapper

Free, open-source argument mapping for the desktop. Lay out a claim, the reasons that
support it and the objections against it, with co-premises, hidden assumptions and
nested rebuttals, then share the map with people on your network.

[Download the latest release](https://github.com/M-Mashreghi/Mind-Mapping/releases/latest)

## Make your first argument map

1. Double-click **Main claim** and enter a conclusion, for example “Our team should run a four-day-week trial.”
2. Select the claim and choose **Reason**. Enter one reason and press Enter to finish. Use **Objection** to add a counterargument. Use **Reply** on an objection to answer it.
3. Add a sticky note for an idea you have yet to place. Drag its corner arrow onto a box for a dashed annotation. To use the note as evidence in the structure, select it, open **Workspace → Build**, choose a target claim and choose **Convert note to a reason**.
4. Save the editable map as an `.amap` file. To share part of it in a slide, Shift-click the boxes and open **Workspace → Output → Selection image**.

**Move or detach a premise.** Drop a premise on empty canvas to unlink it. A free reason stays green and a free objection stays red, without a conclusion number or a line to its former conclusion. Drop it onto a claim to attach it again. To recover a box previously turned into a conclusion by version 0.5.1, select it and choose **Workspace → Build → Make unlinked reason**. Its children move with it and the original bracket resizes. Hold Shift while releasing to keep the premise attached. Undo restores its previous position and relationship.

**Switch sides.** Hover over a premise and click its green + or red − switch. With several co-premises this changes only the hovered premise. Hover over the group's bracket to switch the whole group.

## Find a tool

| Workspace tab | What you can do |
| --- | --- |
| Build | Add independent reasons or joint premises, capture ideas, reuse a claim, choose a box's writing direction and preview a branch layout. |
| Outline | Edit claims as a text outline while the drawing updates. |
| Evidence | Attach a source, page and quotation or turn a selected passage into a claim. |
| Review | Ask critique questions, check circular support, preview suggestions on the canvas, focus a branch and compare saved versions. |
| Exercise | Hide selected claims and relationships in a printable worksheet. |
| Output | Generate an editable branch draft, or copy and save a transparent PNG or SVG of the selection. |

### Working with the 0.5 tools

- **Arrange one branch.** In **Build → Box direction and layout**, preview the positions of the selected claim’s descendants. Apply the layout or cancel. The selected claim stays anchored.
- **Mixed-language maps.** Select each box separately and choose Automatic, Right to left or Left to right. SVG and PDF respect the saved direction.
- **Critique a claim.** In **Review → Critique cards**, pick Causation, Analogy, Authority or Generalization. Click a question to attach it to the selected box.
- **Check circular reasoning.** Choose **Trace support cycles** to trace support through reused claims. Click a reported path to highlight its boxes and inference groups. Sticky annotations are excluded.
- **Suggest a revision.** Collaborators with editing access can submit replacement wording or a proposed joint premise. Preview the proposal on the map. The host can accept or reject it. A wording change made since submission must be reviewed again.
- **Prepare a handout or slide.** In **Output**, draft prose from a claim and edit it before copying. For an image, choose whether to omit crossing connections or include their endpoints. Use **Save image** if your clipboard does not accept the chosen format.

## Download

Choose the file for your platform on the [releases page](https://github.com/M-Mashreghi/Mind-Mapping/releases/latest).

- **Windows:** `Argument-Mapper-Setup-<version>.exe` (installer) or `Argument-Mapper-Portable-<version>.exe` (no install needed)
- **Linux:** `Argument-Mapper-<version>-x86_64.AppImage` (make it executable and run it) or `Argument-Mapper-<version>-amd64.deb` (`sudo apt install ./Argument-Mapper-*.deb`)
- **macOS:** `Argument-Mapper-<version>-mac-arm64.dmg` (Apple Silicon: M1 and later) or `Argument-Mapper-<version>-mac-x64.dmg` (Intel). Open it and drag the app to Applications.

Windows may show a SmartScreen warning the first time because the app is not code-signed; choose **More info → Run anyway**.

macOS says the app "cannot be opened" the first time because it isn't signed with a paid Apple
certificate. Open **System Settings → Privacy & Security**, scroll down and choose **Open Anyway**
(on older macOS you can instead right-click the app and choose **Open**). If macOS says the app
"is damaged", run `xattr -cr "/Applications/Argument Mapper.app"` in Terminal once. When you
first share or join a map, allow **Local Network** access so others can be found.

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
- Words on lines: click a line's label (or double-click the line) to write on it, or turn on Because / But for every line in the theme panel
- Presentation mode: full screen, one claim at a time in speaking order, with claims still to come shown faint (F5 or the Present button)
- Numbering labels (by level, hierarchical, sequential)
- Notes on any box, a notes panel with search, sticky notes, dashed connections between any two boxes (Alt+Click)
- Find (Ctrl+F) across box text and notes
- Export to PNG, SVG, PDF, Markdown or plain-text outline, and notes; import MindMup `.mup` files
- Version history kept inside the map file, with one-click restore
- **Work together on your local network**: one person shares the map from the desktop app,
  others join from the app or from any browser; live edits, cursors and selections,
  view-only guests, comments and emoji reactions on boxes

- **Google Drive** in the desktop app: sign in once, open and save maps in your Drive,
  changes save back automatically, and a map changed elsewhere is never silently overwritten

## Google Drive

In the desktop app choose **File → Google Drive…** and **Sign in with Google**. Your browser
opens Google's sign-in page; when it says you are signed in, go back to the app. Then:

- **Save this map to Drive** creates a `.amap` file in your Drive. From then on every change
  saves back to Drive automatically ("Saved in Drive" next to the title).
- The list shows your maps in Drive; click one to open it.
- If the same map was changed in Drive by someone else (or on another computer) since you opened
  it, the app asks whether to replace it or to save your version as a separate copy.

The app asks only for the `drive.file` permission: it can see the files it created or that you
opened with it, and nothing else in your Drive. The sign-in is stored on your computer,
encrypted with the system keychain where available. **Sign out** removes it.

### Setting up the Google sign-in key (for whoever builds the app)

Google needs an OAuth client for the app. Create one in
[Google Cloud Console](https://console.cloud.google.com): enable the **Google Drive API**, set up
the **Google Auth Platform** (External audience, add the `…/auth/drive.file` scope, add test
users while the app is in testing), then **Clients → Create client → Desktop app**.

- The **client ID** goes in `electron/google-client.json` (it is public anyway).
- The **client secret** is not committed. Add it to the repository as an Actions secret named
  `GOOGLE_CLIENT_SECRET` (**Settings → Secrets and variables → Actions → New repository
  secret**); the release workflow builds it into the installers. For a local build, run
  `GOOGLE_CLIENT_SECRET=… npm run build` (or set `ARGMAP_GOOGLE_CLIENT_SECRET` when starting the app).

Without both values, Drive is simply turned off.

## Working together on a local network

No internet or account is needed. Everyone must be on the same Wi-Fi or office network.

1. The host opens the map in the desktop app and chooses **Share** (top right) → **Start sharing**.
   The app shows an address such as `192.168.1.20:47821` and a link to copy.
2. Others either
   - open the desktop app, choose **Share**, pick the map from the list of maps found on the
     network (or type the address), or
   - open the link the host copied, for example `http://192.168.1.20:47821/?join`, in any
     browser. Nothing has to be installed.

   They choose **Edit** or **Only view** and press **Ask to join**.
3. The host sees who is asking and decides: **Allow this time** (only while this map is being
   shared), **Always allow** (this person gets in without asking from now on), or **Don't allow**.
   The host can also turn an edit request into view only.
4. Under **Share**, the host sees everyone who is in, can switch each person between
   **Can edit** and **View only** at any time, **Remove** someone, and stop always allowing
   someone.
5. While sharing, **Share** also lists **On your network**: people who have the app open on the
   same network. Pick **To edit** or **To view** and press **Invite**; they get an invitation and
   come straight in with **Join**. Anyone can untick **Let people on this network see me and
   invite me** to stay hidden.
6. When joining, the list of shared maps updates by itself and shows who is sharing each map and
   how many people are in it. The host's **Live** button shows how many people are in the map.
7. Everyone sees each other's changes, selected boxes and mouse pointers as they happen. Each
   person's pointer has their own colour with their name next to it. Select a box and use ☺ in
   its toolbar to react, or open **Notes** (N) to read and write comments.

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
| Present (one claim at a time; ← → or Space to move, Esc to end) | F5 |
| Move selection | Arrow keys |

The full list is under **Help → Keyboard shortcuts** (Ctrl+/).

## Development

CI builds and tests the project on Node.js 22.

```bash
npm ci
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

## Credits

Reaction emoji are [Twemoji](https://github.com/jdecked/twemoji) graphics, © Twitter, Inc and other contributors, licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
