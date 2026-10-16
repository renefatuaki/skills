---
"forge": patch
---

The issue skill keeps the draft in reach while its question dialog hides the chat. On the Form route the question holds the full prefill URL. When the form is not on the default branch yet, the URL opens a blank issue with the title, the body and the labels filled in, instead of falling back to a draft in the chat. Before its first question the skill writes the draft to `issue-draft.md` in the session's scratchpad, and every question names the file's absolute path. `prefill-url.mts` takes `body` and `labels` in place of `template` and `fields` for that blank issue.
