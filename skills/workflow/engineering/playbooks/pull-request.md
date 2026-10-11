### Opening a PR

**You own the draft. Clean the diff, commit it, open it.** Invoked at the end of every other playbook. It works through `gh` only and opens one draft per branch against its base, never a stack.

1. **Clean the code.** Run the `clean-code` skill over the diff of the branch against its base, the working tree included.
2. **Clean the comments.** Run the `code-comments` skill over the same diff.
3. **Commit the open changes** with the `commit` skill, those of steps 1 and 2 included.
4. **Open the draft.** The `pull-request` skill opens the draft, or revises the open one, and marks it ready when the conditions of its step 7 hold.
5. **Reply** per Writing the reply in `references/core.md`, with the pull request's URL.

**Reply:** the pull request's URL as `https://github.com/<owner>/<repo>/pull/<number>`, whether it is ready for review or a draft, and the assumptions the `pull-request` skill names.
