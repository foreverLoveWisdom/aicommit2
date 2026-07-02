# Claude Code (Preview)

Use your locally installed [Claude Code CLI](https://claude.com/claude-code) as a commit message provider. Requests run through your Claude subscription (Pro/Max) — **no API key required**.

## Positioning

This provider is for **running `aicommit2` in your terminal** with your Claude subscription. It is *not* intended to be called from inside a Claude Code agent session — an agent writing commits can generate messages itself. If you want agents to reuse aicommit2's convention pipeline, that is a separate integration (planned MCP server mode).

If you have an Anthropic API key instead of a subscription, use the [Anthropic provider](anthropic.md).

## Requirements

- Claude Code CLI installed: `npm install -g @anthropic-ai/claude-code`
- Logged in once: run `claude` and complete login
- A Claude subscription (Pro/Max). **Each request consumes your subscription quota.**

## Configuration

The provider is **opt-in**: it stays inactive until you explicitly configure a model (same rule as Copilot SDK, [#254](https://github.com/tak-bro/aicommit2/issues/254)).

```ini
[CLAUDE_CODE]
model=sonnet
```

Model accepts Claude Code aliases (`sonnet`, `opus`, `haiku`) or full model IDs.

```sh
aicommit2 config set CLAUDE_CODE.model=sonnet
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `model` | *(none — required to activate)* | Falls back to `sonnet` at request time if set empty via CLI flags |
| `timeout` | `60000` | CLI startup adds 1–3s; increase if you see timeouts |
| `codeReview` | `false` | Enable for `aicommit2 --code-review` |

General options (`generate`, `locale`, `type`, `maxLength`, diff compression, etc.) work the same as other providers.

## How it works

aicommit2 spawns the CLI in headless mode and passes the diff via stdin:

```
claude -p --output-format json --model <model> --system-prompt <prompt> --tools "" --max-turns 1
```

## Troubleshooting

- **"Claude Code CLI not found"** — install it globally, or check your `PATH`.
- **"Claude Code is not authenticated"** — run `claude` once and log in.
- **Timeout** — raise `CLAUDE_CODE.timeout` (CLI startup overhead is real).
- **Old CLI versions** — flags like `--tools` require a recent Claude Code release; run `claude update`.
