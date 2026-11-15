### Opening a PR

**You own the pull request. Clean the diff, commit it, open it.** Invoked at the end of every other playbook. It works through `gh` and its `gh stack` extension and opens one pull request per branch against its base, ready for review, a layer of a stack when that base is the branch of another pull request.

1. **Clean the code.** Run the `clean-code` skill over the diff of the branch against its base, the working tree included.
2. **Clean the comments.** Run the `code-comments` skill over the same diff.
3. **Commit the open changes** with the `commit` skill, those of steps 1 and 2 included.
4. **Open the pull request.** The `pull-request` skill opens it, or revises the open one.
5. **Reply** per Writing the reply in `references/core.md`, with the pull request's URL.

**Reply:** the pull request's URL as `https://github.com/<owner>/<repo>/pull/<number>`, the failed checks and test steps, and the assumptions the `pull-request` skill names.
