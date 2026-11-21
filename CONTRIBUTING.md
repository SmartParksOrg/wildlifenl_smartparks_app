# Contributing

Thanks for helping. This page explains how work is organised. The house style is in `CONVENTIONS.md` and the code is explained in `DEVELOPERS.md`.

## Before you start

1. Read `CONVENTIONS.md`. Simple solutions, no build step, no em dashes, natural capitalisation.
2. For anything larger than a fix, open an issue first.
3. Install the git hook once per clone. It strips assistant co-author lines from commit messages:

```bash
git config core.hooksPath .githooks
```

## Development setup

There is nothing to install. Serve the folder and open it:

```bash
python3 -m http.server 8080
```

Run the tests with `npm test` (Node 20 or newer).

## Branches and commits

- Work on `main` for normal changes. Ask before opening a branch; branches are for large rewrites.
- Commit messages: a short imperative first line, a blank line, then why the change is needed. No co-author trailers.
- `main` is what GitHub Pages serves. Every push is a deployment, so test before you push.

## Definition of done

A change is done when all of these hold:

- The code follows `CONVENTIONS.md` and `npm test` passes.
- New logic sits in `assets/js/lib.js` and has a test.
- The page works at phone width (390 px) and desktop width, in the light and the dark theme, without console errors and without horizontal scrolling of the page.
- Documentation is updated in the same commit: `README.md` for users, `DEVELOPERS.md` for mechanisms, `CHANGELOG.md` under Unreleased.
- No new dependency and no build step without a discussion first.

## Reporting bugs

Open a GitHub issue with the app version (Account page), the browser, what you did, what you expected and what happened. Never paste a token in an issue. Security problems go through `SECURITY.md`, not the issue tracker.
