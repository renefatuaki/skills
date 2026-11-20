---
"forge": minor
---

A stack of pull requests now spends CI minutes only on its top layer. The `pull-request` skill names the layers below it `stack/<branch>/<k>` in place of `<branch>-<k>`, and a workflow skips them with `if: ${{ !startsWith(github.head_ref, 'stack/') }}` on its first job. The skill reports every workflow that lacks the line. Before every push it also runs the `run:` steps of the workflows that trigger on `pull_request` locally, so a red run no longer costs minutes.
