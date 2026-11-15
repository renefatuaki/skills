---
name: tidy-history
description: tidy-history, folds the commits of the current branch into one commit per change. Use whenever the user wants to tidy, clean up, squash or rewrite the history of a branch, fold fixups into the commits they finish, or when the pull-request skill pushes a branch.
argument-hint: "[base]"
---

Rebuilds the history of the branch checked out in the session's worktree, so a reviewer reads one commit per change. The tree stays the same.

## Steps

1. **Find the base.** The base is the branch the user or the calling skill named, otherwise the `baseRefName` of the open pull request that `gh pr view --json number,baseRefName` finds for the branch, otherwise `dev` when the remote has it and the current branch is another one, otherwise the default branch. Run `git fetch origin <base>`. `<fork>` is `git merge-base origin/<base> HEAD`. Stop and say why when the current branch is the base or has no commit beyond it.
2. **Check that the branch may be rewritten.** Stop and say why when one of these holds.
   - The stage is not empty, so `git diff --cached --quiet` fails.
   - A person has reviewed the open pull request, so the command prints more than 0, unless the user asks for the tidy anyway. Reviews of apps do not count.

     ```sh
     gh api graphql -F owner='{owner}' -F repo='{repo}' -F number=<number> \
       -f query='query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviews(first: 100) { nodes { author { __typename } } } } } }' \
       --jq '[.data.repository.pullRequest.reviews.nodes[] | select(.author.__typename == "User")] | length'
     ```

   - The remote holds commits the branch lacks. `git fetch origin <branch>` succeeds and `git merge-base --is-ancestor origin/<branch> HEAD` fails.
   - Layers of a stack build on the branch, so `gh pr list --base <branch> --state open --json number` lists a pull request, unless the calling skill rebases them after the push.
3. **Name the changes.** A reviewer reads one commit per change, such as a criterion of the issue, a refactoring it builds on or a diagram update. A commit that only finishes an earlier one of the branch belongs to that commit, such as a fix from a review or a check, a revert, a format or lint pass, or work in progress. Read `git log --reverse --format='%h %s%n%b' <fork>..HEAD` and name the changes. When the branch holds no more commits than changes, the history is tidy and this is the end.
4. **Rebuild the branch.** Note `git rev-parse HEAD` as `<old>`.

   ```sh
   git reset --soft <fork>
   ```

   Commit the stage with the `commit` skill, one commit per named change in the order of the old history, each with the `Refs` and `Closes` trailers its old commits carried. The commit skill prints its plan without waiting and takes the issue from those trailers. A change whose old commits carry none is committed without a reference. Then `git diff --quiet <old> HEAD` must succeed. When it fails, `git reset <old>` restores the branch and leaves the working tree alone.
5. **Push** the rebuilt history when the branch is on the remote. Report a rejected push and stop.

   ```sh
   git push --force-with-lease origin <branch>
   ```

6. **Reply** with the commits before and after the tidy, or why it did not run.

Done when the branch holds one commit per change with the tree of `<old>`, is pushed with lease when it is on the remote, or the reply says why the tidy did not run.
