---
"forge": patch
---

The ci-watcher agent now waits in the foreground. One run issued over 20 `sleep` calls in the background next to five Monitors, and every spawn produced several notifications that it was waiting on its own background work. The agent takes the PR number and the head SHA from its brief, runs `gh pr checks <number> --watch --fail-fast --interval 30` with the Bash timeout at 600000, repeats it while the head SHA is unchanged and reports when the head changes. The `pull-request` skill passes both in the brief.
