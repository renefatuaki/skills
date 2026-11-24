# antigravity

## 0.2.0

### Minor Changes

- d9cc404: The Antigravity models follow the Gemini 4 lineup. The short names are `flash`, `hydrogen`, `argon`, `neon`, and `carbon`, ascending by strength, and resolve to Gemini 3.8 Flash, Gemini 4 Hydrogen, Gemini 4 Argon, Gemini 4 Neon, and Gemini 4 Carbon. `pro` is gone, because Gemini 3.1 Pro is a preview model that only Enterprise accounts list. A slot that cannot run Antigravity falls back to `sonnet` for `flash` and `hydrogen` and to `opus` for the others. A `carbon` slot on an account without Gemini 4 Carbon stays with Gemini and runs the next smaller model the account lists, such as `neon` on Google AI Pro. The usage check also finds a group whose description names a model with its version, such as `Gemini 4 Argon`, as `/usage` does today. The setup guide lists which Google plan includes each model, and the `gemini-prompting` skill links the current Gemini docs on aistudio.google.com.
