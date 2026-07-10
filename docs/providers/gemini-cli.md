# Gemini CLI (Preview)

Use your locally installed [Gemini CLI](https://github.com/google-gemini/gemini-cli) as a commit message provider. Requests run through your Gemini CLI login (free tier or Google AI subscription) — **no API key required**.

## Positioning

This provider is for **running `aicommit2` in your terminal** with your Gemini CLI login. It is the subscription/free-tier counterpart to the [Gemini provider](gemini.md): same model family, different auth lane.

- Use **`GEMINI_CLI`** if you already log into the `gemini` CLI (free tier gives a generous daily quota with a personal Google account).
- Use **`GEMINI`** if you have a `GEMINI_API_KEY` and prefer the metered API.

This mirrors the [Anthropic](anthropic.md) vs [Claude Code](claude-code.md) split.

## Requirements

- Gemini CLI installed: `npm install -g @google/gemini-cli`
- Logged in once: run `gemini` and complete login
- The CLI's free tier or a Google AI subscription. **Each request consumes your CLI quota.**

## Configuration

The provider is **opt-in**: it stays inactive until you explicitly configure a model (same rule as Claude Code and Copilot SDK, [#254](https://github.com/tak-bro/aicommit2/issues/254)).

```ini
[GEMINI_CLI]
model=gemini-2.5-pro
```

Leaving `model` unset in config omits `--model`, so the CLI picks its own default.

```sh
aicommit2 config set GEMINI_CLI.model=gemini-2.5-pro
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `model` | *(none — required to activate)* | Omitted from the CLI call when empty; the CLI uses its default model |
| `timeout` | `60000` | CLI startup adds 1–3s; increase if you see timeouts |
| `codeReview` | `false` | Enable for `aicommit2 --code-review` |

General options (`generate`, `locale`, `type`, `maxLength`, diff compression, etc.) work the same as other providers.

## How it works

aicommit2 spawns the CLI in headless mode and passes the system + user prompt merged via stdin (the CLI has no `--system-prompt` flag):

```
gemini --output-format json --model <model>
```

The diff and instructions are sent on stdin. Output is parsed from the single JSON object the CLI returns.

## Troubleshooting

- **"Gemini CLI not found"** — install it globally, or check your `PATH`.
- **"Gemini CLI is not authenticated"** — run `gemini` once and log in.
- **Timeout** — raise `GEMINI_CLI.timeout` (CLI startup overhead is real).
- **`GEMINI_API_KEY environment variable not found`** — the CLI is falling back to API-key mode; complete the interactive `gemini` login so it uses your account session instead.
