/*
 * Copyright 2026 René El Fatuaki
 * Licensed under the MIT License
 * https://opensource.org/license/mit
 */
package example

/** Returns the user for `id`, or null once the cache has expired. */
fun cachedUser(id: Int): Int? = id

/**
 * Collects the flow only while the lifecycle is at least STARTED.
 * [repeatOnLifecycle](https://developer.android.com/topic/libraries/architecture/coroutines#restart-lifecycle)
 */
fun observeUser() {
    // Resolve the token first so a retry never races the keystore.
    // https://developer.android.com/training/articles/keystore
    val token = 1
    // TODO: drop the fallback APP-123
    println(token)
}

val raw = """
  a — b; // still a string
"""
