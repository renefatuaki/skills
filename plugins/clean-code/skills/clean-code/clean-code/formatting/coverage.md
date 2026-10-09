# Coverage of the formatting rules per language

The TypeScript setup, oxfmt plus oxlint with the pairs in [typescript/.oxlintrc.jsonc](typescript/.oxlintrc.jsonc), is the reference. The other languages mirror it as far as their standard tools allow. This file records, per rule, which tool covers it and where the agent fills the gap by hand, following the sentence in [formatting.md](formatting.md). Verified on 2026-09-30 with oxfmt 0.70, oxlint 1.85, swift-format 6.3, ktlint 1.8.0, detekt 1.23.8, google-java-format 1.36.1, Checkstyle 14.3.0 and Ruff 0.16.9.

| Rule | TypeScript | Swift | Kotlin | Java | Python |
|---|---|---|---|---|---|
| Line width 80 | `printWidth` | `lineLength` | `max_line_length` | no, google-java-format wraps at a fixed 100, Checkstyle `LineLength` matches it | `line-length` |
| Single quotes where the language allows a choice | `singleQuote` | no choice, strings take double quotes | no choice, `'x'` is a `Char` | no choice, `'x'` is a `char` | Ruff default double, kept on purpose |
| Spaces inside braces of object literals | `bracketSpacing` | no object literals | partly, `curly-spacing` on lambdas | no, array initializers print as `{1, 2}` | no, PEP 8 forbids the space |
| Trailing commas wherever allowed | `trailingComma` | `multilineTrailingCommaBehavior` and `multiElementCollectionTrailingCommas`, Swift 6.1 or newer for arguments | `trailing-comma-on-call-site` and `trailing-comma-on-declaration-site`, multi-line lists only | Checkstyle `ArrayTrailingComma` for arrays whose brace closes on its own line, nothing for enum constants | formatter adds them to every split collection |
| Imports sorted | `sortImports` | `OrderedImports` | `import-ordering` | formatter sorts and removes unused imports | `I001` |
| Braces on every control structure | `eslint/curly` all | the language requires braces | partly, `multiline-if-else` and `multiline-loop` only when the body spans several lines, no rule for one-line bodies | Checkstyle `NeedBraces` | no braces in the language, `E701` and `E702` forbid several statements on one line |
| Blank line after the imports | pair | `OrderedImports` | `blank-line-before-declaration`, not in a `.kts` script whose first line after the imports is a statement | formatter and `EmptyLineSeparator` | formatter |
| Blank line after a group of declarations | pair | SwiftLint `let_var_whitespace` | top-level and class-level only, local properties are excluded by the rule | fields only, local variables are not checked | agent |
| Blank line before a declaration that follows a call | pair | SwiftLint `let_var_whitespace` | agent | agent | agent |
| Blank line after a one-line if or loop | pair | agent | agent | cannot occur, `NeedBraces` forbids one-line bodies | agent |
| Blank line after a multi-line statement | pair | agent | agent | agent | agent |
| Blank line around every block with braces | pair | agent for `if`, `for`, `guard` | agent for `if`, `for`, `while`, `try`, `blank-line-before-declaration` covers functions and classes | class members only, formatter and `EmptyLineSeparator`, statement blocks are not checked | `def` and `class` only, formatter |
| Blank line around every type declaration | pair | agent | before `class`, `interface` and `object` always, after them only when a declaration follows, `typealias` not covered | top-level and nested types, formatter and `EmptyLineSeparator`, local types are not checked | `class` by the formatter, `type` aliases not covered |
| Blank line before `return` and `throw` | pair | agent | agent | agent | agent |
| At most four parameters | `eslint/max-params` | SwiftLint `function_parameter_count`, not verified here | detekt `LongParameterList` | Checkstyle `ParameterNumber` | `PLR0913` with `max-args` |
| No nested ternary | `eslint/no-nested-ternary` | no equivalent, prose | no ternary in the language, `if` is an expression | no equivalent, prose | no equivalent, prose |
| No `else` after a `return` | `eslint/no-else-return` | no equivalent, prose | no equivalent, prose | no equivalent, prose | `RET505` |

"pair" means one of the pairs in the TypeScript linter configuration. "agent" means no tool sets it and the agent writes the blank line by the sentence in formatting.md. "no" means the language or the tool rules it out.

## Decisions

Why two configurations depart from the obvious choice, which their schema-only comments cannot say.

- **Java.** Checkstyle keeps `EmptyLineSeparator` although google-java-format already sets those blank lines, so that code which was never formatted is still caught.
- **Python.** `lines-after-imports` stays at its default because the value 1 conflicts with the two blank lines the formatter puts before a top-level `def`. `COM812` is left out because Ruff documents it as conflicting with the formatter.
