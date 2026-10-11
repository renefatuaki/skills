---
"forge": major
---

Add a SessionStart hook that hands Claude the session id, the transcript path and the plugin root, and tells it to read a skill of this plugin from `<root>/skills/<category>/<name>/SKILL.md` instead of calling the Skill tool.
