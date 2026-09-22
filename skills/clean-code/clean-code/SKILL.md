---
name: clean-code
description: clean-code, the rules for readable code. Use when writing code, editing or refactoring code, or when the user names the clean-code skill. Covers names, functions, control flow, classes and vertical layout, and delegates comments to code-comments.
---

Rules for every symbol you write or touch. Clean code is code a developer reads once and understands. Names carry the meaning, functions do one thing at one level of abstraction, control flow stays flat, classes stay focused, and a comment appears only where the code cannot speak. The more code an agent writes, the more this discipline matters, because nobody watched the code being written.

## Steps

1. **Pick the language guide.** Map the file extension and read the guide before writing: `.swift` [languages/swift.md](languages/swift.md), `.kt` `.kts` [languages/kotlin.md](languages/kotlin.md), `.java` [languages/java.md](languages/java.md), `.ts` `.tsx` `.js` `.jsx` [languages/typescript.md](languages/typescript.md), `.py` [languages/python.md](languages/python.md). For any other language apply the rules below with that language's own idioms. Where a language guide and a reference under `references/` differ, the language guide wins.
2. **Read the neighbouring code.** Before naming anything, read the file and its siblings and adopt their verbs, nouns, error idiom and formatter. Consistency beats preference: when the project says `fetch`, the new function says `fetch`. A misleading or domain-wrong existing name is the one exception, see [Renaming](#renaming).
3. **Name every touched symbol.** Nouns for variables, properties and classes. Verbs for functions and methods. A yes or no question for booleans. Specific over generic, so `createUser` instead of `create` and `product` instead of `item`. Full words, no slang, no abbreviation the reader must decode, no adjective the context already supplies. Details in [references/naming.md](references/naming.md).
4. **Shape every touched function.** One thing: every statement one level of abstraction below what the name promises, none mixed with lower detail. Few parameters, related ones grouped in one container. Every side effect implied by the name or the calling context. Each piece of logic in one place. Extract when a block is a coherent sub-task or needs more interpretation than its surroundings, and stop extracting when the split only renames, forces scrolling, or has no free name. Explicit over compact: the longer form wins the moment the reader has to decode the shorter one, the language guide lists the constructs that tempt. Details in [references/functions.md](references/functions.md).
5. **Flatten control flow.** Guards at the top, failing fast. Positive checks, except where one negative check replaces a growing list of positives. Extract a nested control structure into its own function. Replace repeated type checks with polymorphism behind a factory. Signal failure through a structured error contract the language or the project enforces, never through a code, a flag or a message object returned beside a normal value. Details in [references/control-flow.md](references/control-flow.md).
6. **Keep classes focused.** Each class is a real object (private data, public behaviour) or a data container (public data, no behaviour beyond read-only derived values), never both. One responsibility, high cohesion. Real objects follow the Law of Demeter and are told, not asked. Extension by adding a subclass or implementation, not by editing a growing switch. Details in [references/classes.md](references/classes.md).
7. **Order and space the file.** A blank line between concepts, none inside one. Callers above callees, public API above private helpers. A file that holds unrelated things is split. Line length and indentation belong to the project formatter. Details in [references/formatting.md](references/formatting.md).
8. **Apply code-comments.** Every comment in the touched symbol follows the code-comments skill. Nothing else about comments lives here.

Done when every touched symbol has a descriptive name consistent with the project, every touched function does one thing at one level of abstraction with no unexpected side effect and no expression the reader must decode, no nested control structure remains that a guard or an extraction would flatten, every touched class is a real object or a data container with one responsibility, the file reads top down with concepts separated by blank lines, and the comments pass code-comments.

## Renaming

Read the existing names with the domain in mind. A name that describes something other than what the symbol does or holds, or uses the wrong domain term, is not adopted. Rename it when you have checked every dependency and the change is safe: all call sites, overrides, serialized keys, reflection and string references. For a rename that spans many files or touches a public API, dispatch a sub-agent to trace the dependencies first. When the risk stays unclear, keep the name, and name the better one and the reason in your reply. Never block on a question for a rename.

## Scope

The rules apply to the symbols you write or change. Surrounding code stays as it is, so the diff shows the intended change. A file you touch only to add a call keeps its shape.
