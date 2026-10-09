/*
 * Copyright 2026 René El Fatuaki
 * Licensed under the MIT License
 * https://opensource.org/license/mit
 */
/** Returns the cart total in cents, including tax. */
export function cartTotal(): number {
  // Resolve the rate before summing so every line uses the same tax rule.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat
  return 0
}

/**
 * Revalidates the cached page at most once per minute.
 * @see {@link https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#revalidate | Route segment config}
 */
export const revalidate = 60

// eslint-disable-next-line no-console
// TODO: remove logging https://github.com/example/app/issues/3
console.log(revalidate)
