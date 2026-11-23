---
"forge": minor
---

A text meant for pasting outside the session, such as an email, a chat message, a prompt or a post, no longer lands in the reply. The new `clipboard` skill writes it to a file in the scratchpad and copies it with `pbcopy`. Several texts, such as variants of one mail, open in TextEdit instead, and the clipboard stays as it is. The reply names each text and its path in one line. The SessionStart hook hands every session the rule, so it applies without the skill's description having to trigger.
