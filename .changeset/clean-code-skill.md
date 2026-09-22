---
"forge": major
---

Add the clean-code skill with references for naming, functions, control flow, classes and formatting, and guides for Swift, Kotlin, Java, TypeScript and Python. Each guide names the standard formatter and linter of its language, oxfmt and oxlint for TypeScript, swift-format for Swift, ktlint for Kotlin, google-java-format with Checkstyle for Java and Ruff for Python, with a configuration to copy under `formatting/<language>/`. The linters hold three rules for reading speed where the language allows, at most four parameters, no nested ternary and no else after a return. The steps point to the principles laziness-protocol, minimize-reader-load, model-the-domain, boundary-discipline, type-system-discipline and test-behavior-not-implementation, and the TypeScript guide points to typescript-best-practices.
