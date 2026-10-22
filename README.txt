BUDGIT - UPDATED PROJECT

Files:
- index.html: app structure
- script.js: application logic
- sty.css: styling
- fonts/: local Nexa Pro font files

Run locally:
1. Extract the complete project folder.
2. Keep index.html, script.js, sty.css, and fonts/ together.
3. Open index.html with VS Code Live Server for best results.

Updates in this version:
- Savings goal creation is split into focused popup steps.
- Savings target dates and entry dates use Budgit's own in-app calendar (same one as the subscription renewal step), not the browser's.
- Check-in time is chosen on an in-app analog clock: tap or drag the hour, then the minute.
- Savings check-ins appear as a dimmed full-screen popup on whichever tab you are on when the reminder time is reached (while Budgit is open), with a 10-minute snooze.
- Insights includes a monthly budget overview and subscription evaluator.
- Subscription details includes an evaluator action.
- Choosing “Save for it” (or starting a timer on a “Save for this purchase” result) creates a linked savings goal. Existing assessments already marked Saving are added automatically.
- Budget label says “Money available”.

Notes:
- Exchange rates require internet access. When rates cannot be retrieved, cross-currency totals may be unavailable rather than silently treating currencies as equal.
- Reminder popups work while the app is open. Browser tabs that are fully closed cannot show in-app reminders.
- Please test the new workflows in a browser before replacing your working copy. Back up your current data first.
- Ensure your font files are used according to their licence.
