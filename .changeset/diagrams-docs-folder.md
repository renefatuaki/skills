---
"forge": minor
---

The description of the `diagrams` skill names every chat answer that explains how code, a set of files or a feature works. A folder that needs more than one diagram keeps the overview in its `README.md` and puts each further diagram into its own file in the `docs/` folder next to the code. Every diagram must make sense without the code. A table explains the terms the reader needs. An edge that ends a flow early names its reason and its error or log code. A flow that computes or checks a limit gets a worked example with real values from the repository. The `project-docs` skill and the turn hook treat a `docs/` folder at any depth like the one in the root.
