# Manual Verification

Run automated checks first: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run worker:typecheck`, and `npm run build`. For iPhone 6 use the production build via `npm run preview:lan`; do not use Vite's dev server. The simulation controls and scenario runner are available at `?sim=1` and do not represent a live API response.

## Alert State and Network

1. **none → yellow → red → none:** Open `?sim=1`, use «Прогнати сценарій» and confirm the yellow/red/clear transitions and greeting request during red. Select states manually as a follow-up; the first successful poll only initializes the alert state.
2. **none → red → none:** Select none, then red, then none. Wait for the configured clear confirmation polls and confirm one clear signal.
3. **Alert already active at startup:** Open `?sim=1` and select red. Confirm the red state is shown, but no alert tone plays on the first successful poll.
4. **Network failure:** Select “Помилка мережі”; wait for three failed polls. Confirm “Немає зв'язку” appears, the prior alert state remains, and no clear tone plays. Restore network and select none; confirm polling recovers.
5. **Stale response:** Select “Застарілі дані”. Confirm the stale warning appears while alert state and alarm audio do not change.

## Audio Queue and Local Music

6. **Two signal tests in succession:** Press two test-signal buttons quickly. Confirm they play sequentially, never overlap, and wanted music resumes from its interrupted position.
7. **Greeting during an alert:** Add at least one short greeting file to `public/gamarjos`, run `npm run build`, start an alarm and request Гамарджос while it is playing. Confirm the manual greeting starts and the interrupted alarm resumes afterward.
8. **Alert during greeting:** With a greeting file installed, start Гамарджос and trigger yellow/red. Confirm greeting is interrupted, the alarm plays first, and the interrupted greeting does not restart.
9. **Select and play local files:** Select one local MP3/M4A/WAV file. Press Грати and verify it plays in a loop; replace it and confirm the old source stops.
10. **Manual controls:** Exercise Пауза, Грати and the seek slider. Confirm seeking updates the current position.
11. **No autoplay on replacement:** While music is playing, select another file. Confirm the old source stops, the replacement is selected but paused, and playback starts only after Грати.
12. **Alarm and greeting interruption:** With music playing, trigger a signal or greeting. Confirm one source plays at a time and music resumes from the interrupted position after the queue drains. Repeat while music is paused; confirm it stays paused.
13. **Reload and errors:** Reload the page and confirm the playlist is empty and files must be selected again. Test an unsupported/corrupt file and confirm an error is logged/shown without freezing controls.
14. **No selected music:** Open without selecting a file. Confirm music controls are disabled and alarm/greeting playback still works.

## Device and Resilience

15. **Return to tab:** Start playback, switch to another tab/app, then return. Confirm polling resumes immediately and local music position remains coherent.
16. **Screen lock/unlock:** On a device supporting Wake Lock, confirm the lock is requested after page initialization and reacquired on return to the app. On unsupported devices, confirm the one-time collapsible auto-lock hint appears. Lock and unlock the physical screen and verify the app continues safely; iOS may suspend background JavaScript/audio regardless of Wake Lock.
17. **Orientation:** Rotate portrait ↔ landscape while running. Confirm no reload, overlap, clipped labels, or horizontal page scrolling.
18. **Five-minute iPhone 6 test:** On a real iPhone 6 / iOS 12, open the production build, enter the token, touch the page, run for at least five minutes, switch tabs once, test two signals, and rotate the phone. Check for audio overlap, frozen UI, lost polling, or growing memory. Repeat on a current iPhone/iOS release.
