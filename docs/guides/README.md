# Guides

**Runbooks: how to set up, configure and maintain this app.** Procedure, not knowledge.

A guide answers *"what do I do?"* — the click path, the value to paste, the command to run, what to
check afterwards, and what to do when it fails. Anything a person follows step by step, once or
occasionally, belongs here.

## What goes where

The distinction that keeps this folder useful:

| | Lives in | Answers |
| --- | --- | --- |
| **Procedure** | `guides/` | "How do I set up the Slack app?" |
| **Knowledge** | `domains/`, `data-model.md`, `architecture.md` | "How does the Slack integration work?" |
| **Rationale** | `decisions/` | "Why one bot token and not per-user OAuth?" |

So a guide may state a constraint, but it shouldn't argue for it — it links to the ADR instead. And a
domain doc shouldn't grow install steps; it links here.

**When the same fact appears in both, the guide is authoritative**, because it's the one someone is
following while something is broken. Fix it first, then reconcile the explanation.

Two things deliberately *not* here: day-to-day dev commands (`bun run check` and friends live in
[`../development.md`](../development.md) and the root `README.md`), and anything an end user does
inside the product — guides are for whoever operates the app, not whoever uses it.

## The guides

| Guide | Covers |
| --- | --- |
| [slack.md](./slack.md) | Setting up the Slack channel integration — app manifest and scopes, the bot token, the `/invite` requirement for existing private channels, verification walkthrough, troubleshooting keyed on the real error strings, and the `test-` prefix outside production |
| [google-drive.md](./google-drive.md) | Setting up the Google Drive folder integration — enabling the Drive + **Picker** APIs, why the consent screen must stay **Internal** (that's what permits the restricted `drive` scope with no Google verification), the Picker API key and project number, the shared drive id, **"everyone signs out and back in once" as a required step** (adding the scope grants nothing retroactively), a verification walkthrough, troubleshooting keyed on the real error strings, and pointing dev at a **separate** shared drive instead of a `test-` prefix |

## Writing one

- **Number the steps** and put the thing that blocks people earliest — a required restart, a
  permission they may not have — before the detail.
- **Key troubleshooting on the exact string someone sees.** A table of real error messages is worth
  more than prose about failure modes, because it's searchable by the person hitting it.
- **Say what the integration deliberately doesn't do**, so nobody hunts for a feature that was never
  built.
- Keep credentials out. Reference the env var name; never a value.
