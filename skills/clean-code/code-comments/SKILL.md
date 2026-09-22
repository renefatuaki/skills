---
name: code-comments
description: code-comments, the rules for every code comment. Use when writing code, editing code that carries comments, reviewing comments, or when the user names the code-comments skill.
---

Rules for every comment you write or touch. A comment earns its place only when it tells the reader something the code cannot: what a non-obvious symbol does, why a foreign API is used the way it is, or how a complex workflow proceeds. Everything else the code says through its names. The more code an agent writes, the more this discipline matters, because nobody watched the code being written.

## Steps

1. **Pick the language guide.** Map the file extension and read the guide before writing a comment: `.swift` [languages/swift.md](languages/swift.md), `.kt` `.kts` [languages/kotlin.md](languages/kotlin.md), `.java` [languages/java.md](languages/java.md), `.ts` `.tsx` `.js` `.jsx` [languages/typescript.md](languages/typescript.md), `.py` [languages/python.md](languages/python.md). For any other language apply the rules below with that language's own doc-comment link syntax.
2. **Pick the comment language.** Read the existing comments of the project and write in the language most of them use. English when there are none.
3. **Doc line per touched symbol.** For every class, function, method or property you write or change, ask whether the name already says what it does. If it does, the symbol gets no doc comment. If it does not, write one summary line. When that line explains foreign behaviour (a framework, a library, a specification), add the link line under it. When the link alone explains it, write only the link line.
4. **Step comments per touched body.** Write step comments inside a function only when both hold: the body has at least three phases, and the order or the side effects cannot be read from the code. One imperative line per step, numbered `1.` `2.` `3.` in execution order. A step that relies on a foreign API gets a bare URL on its own unnumbered comment line right under it.
5. **Prune.** Every comment inside the touched symbol must still be true for the current code. Rewrite a stale comment or delete it. Renumber the steps when you add, remove or reorder one. Delete commented-out code. Delete a `TODO` or `FIXME` that carries no ticket or issue link.

Done when every comment in the touched symbol is one content line, punctuated, free of em-dashes and semicolons, linked where it explains foreign behaviour, and true for the current code.

## Form

- One content line. Verb first, full sentence or fragment, ends with a period: `Inserts the item at the head of the list.`
- No em-dash, no en-dash, no semicolon inside a comment. Write two sentences or two comments instead.
- Block delimiters (`/**`, `*/`) do not count as lines. Without a link use the one-line block form the language allows.
- The link line is the only second line. Summary plus link is the maximum. Python docstrings with a link take three lines (summary, blank line, link), see the Python guide.
- Parameters and return values are explained by their names, never by `@param`, `@return`, `- Parameters:`, `Args:` or similar tags.

## Links

- Link only what the reader cannot know from the code: framework, library or spec behaviour. Prefer the official documentation.
- In a doc comment on a symbol, use the language's native link syntax from the language guide. It renders as a clickable link in the hover at every call site.
- In a step comment inside a body, write the bare URL alone on its own comment line. Editors make it clickable in place.

## Special comments

- `// MARK:`, `#region` and license headers stay as they are. In Swift, add `// MARK: -` groups when a type holds two or more of the groups listed in the Swift guide.
- `TODO` and `FIXME` carry a ticket or issue link on the same line.
- Commented-out code is deleted. Version control keeps the history.

## Hook feedback

A PostToolUse hook scans every edited file for em-dashes, semicolons, comment blocks longer than two content lines, and `TODO`/`FIXME` without a link. When it reports `path:line rule`, fix each reported line in your next edit. Silence means the mechanical rules pass, the rules above still apply.
