# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Use the "Report a vulnerability" button under the Security tab of the GitHub repository. That creates a private advisory that only the maintainers can read.

Include what you found, how to reproduce it, and which version (Account page) or commit you tested. You get a first reply within seven days.

## Supported versions

Only the version on `main`, which is the one GitHub Pages serves, receives fixes.

## Scope

This repository is a static web app. The maintainers fix problems in this code. Problems in the WildlifeNL API go to its maintainers at Utrecht University; problems in Smart Parks Protect go to that repository.

## How the app handles credentials

- The WildlifeNL token is stored in the browser only: in `localStorage` when you choose to stay signed in, otherwise in `sessionStorage`. It is sent to the WildlifeNL API address you signed in to and nowhere else.
- WildlifeNL tokens do not expire. Signing out removes the token from the browser; it does not revoke it. Use "Keep me signed in" only on a device you trust. If a token leaks, ask the WildlifeNL administrator to revoke it.
- The Protect password is sent to your Protect server once to get an access token. Neither is stored; the access token is gone when the page reloads.
- A content security policy allows scripts only from this site and one pinned, integrity-checked library. There are no analytics and no third-party scripts.

## Secrets

Never commit a token or a password, and never paste one in an issue. If you do so by accident, have it revoked first and then tell the maintainers; removing it from history is not enough.
