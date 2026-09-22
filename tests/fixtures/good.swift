// Copyright 2026 René El Fatuaki
// Licensed under the MIT License
// https://opensource.org/license/mit
import Foundation

// MARK: - Lifecycle
/// Fetches the user and caches the result for the session.
/// [URLSession](https://developer.apple.com/documentation/foundation/urlsession)
func fetchUser() {}

// TODO: retry on timeout https://github.com/example/app/issues/42
func retry() {
    // Resolve the token before the first request.
    // https://developer.apple.com/documentation/security/keychain-services
    let token = 1
    // Apply the changes atomically.
    _ = token
}

/// Uses `a; b` inline code and the &amp; entity.
func inlineCode() {}

let multi = """
  a — b; // still a string
  """
