// The Markdown parsing the documentation hook and the diagram hook share, code fences and link targets.

import { dirname, join, resolve } from 'node:path';

/**
 * Matches the line that opens or closes a code fence, also inside a list item or a quote, and captures its indent, its marker and its info string.
 * @see {@link https://spec.commonmark.org/0.31.2/#fenced-code-blocks | CommonMark, fenced code blocks}
 */
export const FENCE = /^([\s>]*)(`{3,}|~{3,})\s*(\S*)/;

/**
 * Captures the target of every inline link and image on a line, in angle brackets or bare with balanced parentheses, its title left out.
 * @see {@link https://spec.commonmark.org/0.31.2/#links | CommonMark, links}
 */
const LINK_TARGET = /\]\(\s*(?:<([^>\n]*)>|((?:[^()\s]|\([^()\s]*\))+))/g;

/**
 * Matches a target that starts with a URI scheme or with two slashes, which is no path in the project.
 * @see {@link https://www.rfc-editor.org/rfc/rfc3986.txt | RFC 3986, section 3.1}
 */
const SCHEME = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Tells whether the fence line closes the open marker, which takes the same character, at least its length and no info string.
 * @see {@link https://spec.commonmark.org/0.31.2/#fenced-code-blocks | CommonMark, fenced code blocks}
 */
export function closesFence(fence: RegExpMatchArray, open: string): boolean {
  const sameCharacter = fence[2][0] === open[0];

  return sameCharacter && fence[2].length >= open.length && fence[3] === '';
}

/** Returns the target of every inline link and image on the line as written. */
export function linkTargetsOf(text: string): string[] {
  return [...text.matchAll(LINK_TARGET)].map(match => match[1] ?? match[2]);
}

/**
 * Returns the path a relative link points at, a leading slash meaning the project root, or null for a URL and a bare anchor.
 * @see {@link https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax.md#relative-links | GitHub Docs, relative links}
 */
export function resolveTarget(
  target: string,
  from: string,
  root: string,
): string | null {
  if (SCHEME.test(target)) {
    return null;
  }

  const path = target.replace(/[#?].*$/, '');

  if (path === '') {
    return null;
  }

  const decoded = decode(path);

  return decoded.startsWith('/')
    ? join(root, decoded)
    : resolve(dirname(from), decoded);
}

/** Decodes percent escapes such as %20, a malformed escape leaves the path as it is. */
function decode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
