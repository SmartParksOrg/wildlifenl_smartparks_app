# Conventions

The same house style as Smart Parks Protect, cut down to what a static web app needs.

1. **Fail loudly.** Show the person what went wrong, with the server's own message. Never swallow an error.
2. **Short and clear documentation.** Keep explanations concise without losing clarity.
3. **Open source friendly.** Never commit tokens, passwords or anything that should not be public.
4. **Prefer simple solutions.** Plain HTML, CSS and JavaScript modules. No framework, no bundler, no build step.
5. **Use built-in features.** Check what the browser already offers (`fetch`, `<datalist>`, `<details>`, form validation, `AbortSignal.timeout`) before writing code or adding a library.
6. **No quick fixes.** Fix a problem so it holds for every sensor and every account, not only the one at hand.
7. **Clean repo.** No redundant Markdown files, no dead code, no commented-out code.
8. **Colours come from tokens.** Rules in `assets/app.css` use the variables on `:root` and `.dark`, never a hex value. The tokens match Smart Parks Protect.
9. **Logic is separate from the page.** Pure functions live in `assets/js/lib.js` and have tests. `assets/js/app.js` draws.
10. **Every list has a bound.** Tables render a page at a time; requests have a timeout.
11. **No title case.** Use natural English capitalisation: capitals for the first word of a sentence or heading and for proper nouns ("Sensor readings", "Smart Parks Protect", "WildlifeNL").
12. **No em dashes.** Never use em dashes or double hyphens in text. Use commas, colons, semicolons or separate sentences.
13. **Write like a person.** No filler phrases. Simple, direct sentences that a non-native reader follows easily.
14. **Text people read is plain.** Buttons say what they do ("Load readings"), errors say what to do next.

Always ask before opening a new branch. Work on `main`, except for very large rewrites.
