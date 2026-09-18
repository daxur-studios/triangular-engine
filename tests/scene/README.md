# Scene tests (M1)

Install dependencies with `npm install`, then run the first browser test with:

```powershell
npx playwright install chromium
npm run test:scene
```

Use `npm run test:scene -- --headed` while authoring. The test enables the
explicit `sceneTest=agent-reference-v1` fixture and talks to the typed bridge;
normal lab sessions do not publish `window.__sceneTest`. M1 captures evidence in
the Playwright HTML report, including a structured `m1-run-manifest.json` and
PNG. Manifests explicitly record unavailable identity fields and are retained
with the report; generated `playwright-report/` and `test-results/` may be
deleted after evidence is copied to durable CI storage. It does not establish
visual baselines or measure performance.

The `local visual walkthrough` test enables Playwright video recording for that
test only. After a run, open the report with `npm run test:scene:report`; the
report contains the WebM recording alongside the test
steps and captures. Video is visual evidence and is not used for performance
measurements. Run only this recording with `npm run test:scene:walkthrough`;
it hides the inspection panel, uses a 1280x720 viewport, enables canvas pointer
input, and pauses between focus, orbit, and zoom states so the motion is visible
in the WebM.
