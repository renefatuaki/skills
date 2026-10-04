---
name: project-docs
description: project-docs, the rules for every Markdown file that documents a project. Use when writing or editing a README.md or a file under docs/, when a code change alters behaviour the documentation describes, or when the user names the project-docs skill.
---

Rules for every documentation file you write or touch. A doc answers one question for a developer or an agent in one pass. One question per file, short sentences, tables and lists before paragraphs, and a link wherever the code or the official documentation already holds the answer.

## Scope

Documentation is `README.md` in any folder, every file under `docs/`, and `CONTRIBUTING.md`, `ARCHITECTURE.md`, `SECURITY.md` and their like in the repository root. A `README.md` inside a dot folder or a dependency folder stays as it is. `docs/adr/` and `CONTEXT.md` keep their own format. `SKILL.md`, `CLAUDE.md`, `AGENTS.md`, changelogs, changesets, issue and pull request templates and licenses follow their own rules.

## Steps

1. **Pick the language.** Read the existing documentation and write in the language most of it uses. English when there is none.
2. **Pick the type.** Name the one question the file answers and take its type from [Types](#types). New content that answers a second question goes into its own file.
3. **Place the file.** A new file is `docs/<topic>.md` in kebab-case and gets a row in the README table. An existing structure of the project wins.
4. **Open with the question.** One `#` title, then the question the file answers as one sentence. The README opens with its purpose instead. The README table carries the opening sentence of each file word for word.
5. **Write each block in its form.** Every block follows [Form](#form), every link follows [Links](#links).
6. **Prune.** Bring the whole file to these rules, and make every statement in it true for the current code. When an existing file answers two questions, name the split in your reply and split after the user agrees.

Done when every touched file answers one question, opens with that question, is linked from the README, shows every block in its form, links what the code or the official documentation already says, and holds only statements that are true for the current code.

## Types

| Type | The reader asks | Form |
| --- | --- | --- |
| Overview | What is this and where do I find what? | Purpose, quick start, table of links |
| How-to | How do I reach X? | Numbered steps, one action each |
| Reference | Which options, commands or fields exist? | Tables |
| Explanation | Why is it built this way? | Short paragraphs, a diagram |

The README is the overview. It holds one sentence of purpose, the quick start with the requirements and the commands that get the project running, and a table that links every file under `docs/`. Everything else lives under `docs/`.

## Form

Write [GitHub Flavored Markdown](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax.md). The rendered view on GitHub is where the reader meets the file.

- A table when the entries share two or more attributes.
- A numbered list for a sequence. A bullet list for peers. Each item is one sentence.
- A paragraph only to give a reason, the why behind a choice. Three sentences at most.
- Short sentences. Where an em-dash, an en-dash or a semicolon would join two clauses, write two sentences.
- Every command and every example in a fenced code block with a language tag, complete, free of prompt characters, and run once before you write it down.
- A flow or a structure with three or more participants is a diagram in place of prose. Diagrams follow the diagrams skill.
- A warning or a note the reader must see is an [alert](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax.md#alerts). `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]` or `> [!CAUTION]` stands on a quoted line of its own, the text on the quoted lines under it. Two alerts per file at most, each at the top level with prose between them.
- The headings are the table of contents. GitHub builds the [outline](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes.md#auto-generated-table-of-contents-for-markdown-files) of every file from them, so a file carries none of its own.

## Links

- The code is the source. What a file in the repository already says (configuration, scripts, types) gets a relative link. The doc states only what the code cannot say. A reference names each entry with its meaning and links the file that defines it for the details.
- Foreign behaviour (a framework, a library, a specification) gets one sentence and the link to the official documentation.
- Link the plain-text form of a page when the host serves one, so an agent following the link reads Markdown instead of HTML: `.md` appended to the path on docs.github.com and code.claude.com, `.patch` appended to a GitHub commit URL, `raw.githubusercontent.com` for a file in a repository. Check the variant answers before using it, a `curl -sI` showing `text/markdown` or `text/plain` is enough.
- Every relative link resolves to a file that exists.

## markdownlint

markdownlint checks the Markdown syntax of every documentation file. The hook needs the library and a configuration in the project, reads both and reports the findings after every edit. If the project has no markdownlint, install it after confirmation with the "Add dev dependency" command of the `package-manager` skill. If the project root has no `.markdownlint.jsonc` and no `.markdownlint.json`, copy [.markdownlint.jsonc](assets/.markdownlint.jsonc) into it.

```sh
pnpm add -D markdownlint
```

- [markdownlint](https://raw.githubusercontent.com/DavidAnson/markdownlint/main/README.md)
- [Rules](https://raw.githubusercontent.com/DavidAnson/markdownlint/main/doc/Rules.md)

## Hook feedback

A PostToolUse hook scans every edited documentation file for em-dashes, semicolons, relative links without a target, a missing opening sentence, and a file under `docs/` that the README does not link. In a project that has markdownlint and its configuration, the hook also reports what markdownlint finds. When it reports `path:line rule`, fix each reported line in your next edit. Silence means the mechanical rules pass, the rules above still apply.
