---
"forge": major
---

Add the templates skill, which owns the issue forms and the pull request template of a repository and keeps them up to date without asking. The templates come from the skill's assets, with only the `contact_links` of `config.yml` and the prerequisites of the pull request template taken from the repository. It writes every template that is missing, overwrites every one that differs, whoever wrote it, and leaves other files in `.github/ISSUE_TEMPLATE/` alone. Each asset starts with a marker line that says the file is overwritten. Each kind is its own commit, on the branch `chore/templates` when the default branch or `dev` is checked out. The skill is hidden from the model and starts through `/templates` or when the issue or pull-request skill reads it by path.
