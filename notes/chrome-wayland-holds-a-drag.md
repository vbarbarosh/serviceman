# Chrome on Wayland holds a drag, and the page looks stuck

Found on 2026-09-15 from two screen recordings of the control page, after a week of "the
page stuck several times, last time when I just switched the skin".

## What it looked like

- Nothing on the page took a click. The rail, the tabs, the theme button — nothing.
- F12 did nothing either, so DevTools could not be opened once it had happened.
- The numbers in the header kept ticking: `serviceman up 24m 46s`, `24m 47s`, and so on.
  The page's script was alive and polling the whole time.
- The skin menu stayed open on screen after a skin had been chosen, although the picker's
  label had already changed to the new skin.
- No error in the console. A reload always cured it. It happened in incognito too, so no
  extension was involved. It never happened in Firefox.
- Reliable repro: switch skins as fast as you can, a → b → a, on the picture cards.

## What it was

A browser drag that the browser never let go of.

Each skin card is a `<button>` with an `<img>` cover and a label. A fast second click on it
falls inside the double-click window and moves a little, and that is how a browser starts
an HTML5 drag: of the picture, or of the label text the double click had just selected —
the first recording shows the word "Classic" highlighted at exactly that moment.

Chrome 153 on Linux under Wayland (`--ozone-platform=wayland`, GPU rendering) then kept the
drag session open. While a drag is in progress the browser hands every pointer and keyboard
event to it, so no click reached the page and no shortcut reached the browser. The page was
never involved: Vue rendered every update (the label changed), timers ran, nothing threw.
The menu that "stayed open" was the last frame the page had drawn before input stopped
reaching it — the click on the backdrop that would have closed it was never delivered.

Firefox ends such a drag on release. Headless Chrome, driven over the DevTools protocol,
never reproduced it either: it clicks with no real pointer, so it cannot drag.

## What was tried first, and why it was wrong

- A loop in the page: ruled out, the timers kept running.
- An invisible overlay: nothing in the CSS but the menu's own backdrop, which closes itself.
- A render error swallowed by the app's error handler: plausible from the first recording
  (label changed, menu stayed), wrong once the second recording showed a clean console.
  The handler now puts a red bar on the page for any render error, which is worth keeping.
- A DOM-tidying extension breaking Vue's `<template v-if>` fragment anchors: fitted Chrome vs
  Firefox, ruled out by incognito. The skin menu is plain elements now anyway.
- The Ledger skin's `@import` of web fonts: fitted Chrome vs Firefox, never tested, moot.

## The fix

`src/main/public/serviceman.js`, `serviceman.css`:

- the page cancels every `dragstart` document-wide — a file dropped in from outside still
  arrives, since that drag begins outside the page;
- cover pictures are `draggable="false"` with `pointer-events: none`, so the click is the
  card's;
- cards are `user-select: none`, so a double click selects no label to drag.

Verified by the user: "i tried as quick as i can, no stuck".

## The lesson

A page that keeps updating but takes no input is not a page that hangs. Ask what stands
between the pointer and the page: a drag, a modal, a capture. And ask for a screen recording
before theorising — the two recordings held every clue: the highlighted label, the label
changing while the menu stayed, the clean console, the ticking counter.
