/*
 * Copyright 2026 René El Fatuaki
 * Licensed under the MIT License
 * https://opensource.org/license/mit
 */
package example;

class Good {

  /** Returns the customer ID, or null when the session is anonymous. */
  String customerId() { return null; }

  /**
   * Retries idempotent requests with exponential backoff.
   * @see <a href="https://docs.spring.io/spring-framework/reference/integration/rest-clients.html">Spring REST clients</a>
   */
  void send() {
    // Resolve the token first so a retry never races the credential store.
    // https://docs.spring.io/spring-security/reference/servlet/authentication/index.html
    int token = 1;
    // TODO: remove the retry cap #88
    System.out.println(token);
  }
}
