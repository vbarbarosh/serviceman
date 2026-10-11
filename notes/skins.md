# Skins

A skin changes how the control page looks and how it is built, without touching what it can
do. The classic page is what you get with no skin picked; a skin is opt-in, per browser.

## What a skin is

One folder under `skins/`, holding two files:

- `skin.json` — `{"title": "Workspace", "layout": "tiles"}`. `title` is what the picker
  shows. `layout` names one of the layouts `public/serviceman.js` implements; a skin picks
  one, it does not bring its own.
- `skin.css` — loaded after `serviceman.css`, so it overrides it: the theme tokens (both
  `[data-theme="light"]` and `[data-theme="dark"]` — every skin carries both themes), fonts,
  and the styles of its layout's own elements.
- `cover-light.svg` and `cover-dark.svg` — optional pair, a small picture of the skin
  (160×100) per theme; the picker shows the one matching the current theme and swaps it live
  with the theme toggle. A skin without the pair shows its title alone. Classic's pair is
  `public/cover-classic-light.svg` and `public/cover-classic-dark.svg`.

Drop a folder in, and it is in the picker. Nothing is registered anywhere else.

## The layouts

- `rail` — the classic build: rail on the left, one pane on the right.
- `tiles` — the rail, and the right side a grid of live panes (facts, logs, shells) open side
  by side. Open panes are kept in `localStorage["serviceman.tiles"]`, not in the address.
- `console` — no rail; the fleet as one table, the picked row open in place, the tail of the
  log pinned at the foot.
- `board` — no rail; every service a card, the picked card grown in place.

In `console` and `board` there is no rail to come back through, so any pane that covers the
board (the config editor, the log, a form, a remote's page) gets a "← every service" bar
above it.

## The four skins

- `workspace` — layout `tiles`, the classic colours. The structural upgrade.
- `ledger` — layout `rail`, IBM Plex on warm paper, dotted leaders, ruled fact rows.
- `console` — layout `console`, JetBrains Mono; dark is native, light reads like a printout.
- `board` — layout `board`, Space Grotesk titles, state chips readable from a distance.

The mockups these came from (with sample numbers, side by side):
https://claude.ai/code/artifact/6b581c36-5ea9-4570-8bf0-bc7ea2273be8

## How it is wired

- `GET /api/v1/skins` lists the folders (`src/skins_read.js`); the header picker is built
  from it. No folders, no picker.
- `GET /skins/<name>/skin.css` is served by the control server only (`handle_control_request`
  cuts the `/skins` prefix and serves inside the skins folder; the folder guard of
  `serve_static_file` keeps it there).
- The choice is `localStorage["serviceman.skin"]`. `index.html` puts the `<link>` on before
  the first paint; picking a skin swaps the same link's `href` live, no reload.
- The fonts come from Google Fonts by `@import`, with system faces as fallback — offline the
  skin still works, in the fallback face. To make a skin fully offline, put the woff2 files
  in its folder and swap the `@import` for `@font-face` lines.

## Not covered

- The waiting page, the error pages and the index page are written by the server with the
  colours of `src/page_tokens.js`; skins do not reach them.
- A deep link like `/services/x/logs` opens the full-pane logs in every skin, the workspace
  one included — the workspace's own Logs buttons open tiles instead.
