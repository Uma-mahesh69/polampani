# Contributing to PolamPani

Thanks for helping farmers and farm workers. Small, focused pull requests are easiest to review.

## Good first contributions

- **Translations**: Telugu strings live in `public/js/te.js`, keyed by the English text. Keep `{placeholders}` intact. A new language is a new file plus a toggle.
- **Villages**: add your district's villages and coordinates to `VILLAGES` in `src/catalog.js`.
- **Crop calendars**: monthly labour demand per type of work is in `CROP_CALENDAR` in `src/catalog.js`.
- **Language understanding**: keywords for work types, numbers and dates are in `src/nlp.js`. Add a test case in `test/nlp.test.js` for every phrase you teach it.

## Development

```bash
npm install
npm run dev     # restarts on file changes
npm test        # run before opening a pull request
npm run reset   # wipe and reseed the demo database
```

Requires Node.js 22.13 or newer. There is no build step: the frontend is plain ES modules in `public/js`.

## Guidelines

- Write interface text in plain language from the farmer's or worker's point of view, and add the Telugu translation.
- Every match the AI makes must stay explainable: if you add a feature to `src/matcher.js`, add a reason for it in `explain()`.
- Keep the app usable on a cheap Android phone on a slow connection.
