---
name: clipboard
description: clipboard, hands a text the user will paste somewhere else to the macOS clipboard, or to TextEdit when there are several, in place of writing it out in the reply. Use whenever you write a text meant to be pasted outside this session, such as an email, a chat message, a prompt for another tool, a post or a comment, even when the user does not say "copy". Not for code or files that go into the repository.
---

The user pastes the text from the clipboard or from TextEdit, never from the terminal. The reply names the text and its file, and never holds the text.

## Steps

1. **Write each text to its own file** in the scratchpad directory of the session, named after its content, such as `mail-tax-advisor.txt`. Write plain text without Markdown syntax. Keep Markdown only when the target renders it, such as a GitHub comment, Slack or a prompt for a model, and name the file `.md` then.
2. **Hand it over.**
   - One text goes to the clipboard. The locale makes `pbcopy` read the file as UTF-8. Without it, umlauts break.

     ```sh
     LANG=en_US.UTF-8 pbcopy < <file>
     ```

   - Several texts, such as variants of one mail, open in TextEdit, each in its own window. The clipboard stays as it is.

     ```sh
     open -a TextEdit <file> <file>
     ```

3. **Reply with one line per text** in the language of the conversation. The line says what the text is, what happened to it and its absolute path, such as `Mail to the tax advisor copied. /private/tmp/.../mail-tax-advisor.txt`. No excerpt of the text.

A revision, such as "make it shorter", overwrites the same file and runs step 2 again. When the user asks for the text on another device, send the file with SendUserFile.
