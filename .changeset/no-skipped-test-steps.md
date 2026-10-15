---
"forge": patch
---

The `pull-request-review` skill runs every test step itself and hands a step to the reviewer only for a named reason, such as a physical device or another person, written in parentheses. It tests VoiceOver itself from the accessibility tree, the reading order and `performAccessibilityAudit()`.
