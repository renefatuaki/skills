// The code languages the comment hooks know, by file extension.

/** The comment syntax of a language, slashes and blocks or hashes and docstrings. */
export type Syntax = 'c' | 'python';

/** The comment syntax of a language and its guide in the code-comments skill, relative to the plugin root. */
export type Language = {
  syntax: Syntax;
  guide: string;
};

const GUIDES = 'skills/clean-code/code-comments/languages';

const SWIFT: Language = { syntax: 'c', guide: `${GUIDES}/swift.md` };
const KOTLIN: Language = { syntax: 'c', guide: `${GUIDES}/kotlin.md` };
const JAVA: Language = { syntax: 'c', guide: `${GUIDES}/java.md` };
const TYPESCRIPT: Language = { syntax: 'c', guide: `${GUIDES}/typescript.md` };
const PYTHON: Language = { syntax: 'python', guide: `${GUIDES}/python.md` };

/** Maps a file extension to its language, a file with any other extension is not checked. */
export const LANGUAGES: Record<string, Language> = {
  '.swift': SWIFT,
  '.kt': KOTLIN,
  '.kts': KOTLIN,
  '.java': JAVA,
  '.ts': TYPESCRIPT,
  '.tsx': TYPESCRIPT,
  '.js': TYPESCRIPT,
  '.jsx': TYPESCRIPT,
  '.mjs': TYPESCRIPT,
  '.cjs': TYPESCRIPT,
  '.mts': TYPESCRIPT,
  '.cts': TYPESCRIPT,
  '.py': PYTHON,
};
