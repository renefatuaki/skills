---
"forge": patch
---

The issue skill puts the draft into every question it asks once the draft exists, because the question dialog hides the chat. The skill writes the draft to `issue-draft.md` in the session's scratchpad and every question names the file's absolute path, and on the Form route the question also holds the full prefill URL.
