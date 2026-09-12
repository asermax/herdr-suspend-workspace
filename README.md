# herdr-suspend-workspace

A [herdr](https://herdr.dev) plugin that **suspends** a workspace: snapshots its tabs,
pane layout, and agent conversations, then closes it so it (and its agents)
disappear from the sidebar. Restore it later from a popup picker — the layout is
rebuilt and agents resume their conversations.

<img width="1727" height="859" alt="Screenshot_20260731_004802" src="https://github.com/user-attachments/assets/38e01906-1c0d-498e-acfb-efbd3b2ee247" />

## How it works

- **Suspend** captures the workspace via `layout.export` (per tab) and
  `pane.list` (for each pane's agent session), stores a snapshot under
  `HERDR_PLUGIN_STATE_DIR/suspended/`, then calls `workspace.close`.
- **Restore** creates a fresh workspace and replays each tab with `layout.apply`,
  where every pane comes up as a plain shell in its original cwd. Agent panes then
  get their resume argv (e.g. `claude --resume <id>`, `pi --session <id>`) typed
  into that shell, so conversations resume. This is the same approach herdr uses
  when it restores agents after a server restart: the shell stays underneath the
  agent, so quitting the agent leaves the pane open instead of closing the tab.
  Non-agent panes rarely carry a command to replay — see below for why.

The resume-argv table mirrors herdr's own `src/agent_resume.rs`, so only
official `herdr:<agent>` sessions are resumable.

## Requirements

- herdr ≥ 0.7.5
- [bun](https://bun.sh) (runtime for the plugin scripts)

There is no build step — the scripts run straight from source, so `bun` has to be
on the PATH of the herdr *server* (not just your shell). If bun comes from a
version manager, that usually means starting herdr from a shell where it resolves.

## Install

```bash
herdr plugin install asermax/herdr-suspend-workspace
```

### Local development

```bash
herdr plugin link ~/workspace/asermax/herdr-suspend-workspace
herdr plugin list
herdr plugin action list --plugin asermax.workspace-suspend
```

## Usage

The plugin exposes two actions and one popup pane:

| Entrypoint | Trigger | What it does |
| --- | --- | --- |
| `suspend` | action (workspace context) | Snapshot + close the current workspace |
| `resume` | action (workspace context) | Opens the suspended-workspaces picker |
| `picker` | popup pane | Interactive list with search; `enter` restores, `x` deletes, `esc` cancels |

### Picker keys

| Key | Mode | Action |
| --- | --- | --- |
| `↑`/`↓`, `j`/`k`, `ctrl+p`/`ctrl+n` | browse, search | move selection |
| `enter` | browse | restore the selected workspace |
| `x` | browse | delete the selected snapshot (asks to confirm) |
| `/` | browse | start searching (matches label and cwd) |
| `enter` | search | keep the filter and go back to browsing |
| `esc` | search | discard the edit, back to the previous filter |
| `ctrl+u` | browse, search | clear the filter |
| `esc`, `ctrl+c` | browse | close the popup |
| `y` | confirm | go ahead with the deletion |
| any other key | confirm | cancel the deletion |

The search is token-based: `lay adm` matches a workspace whose label or cwd
contains both `lay` and `adm`.

Deleting discards the snapshot file permanently — the workspace it described is
already closed, so there is nothing left to restore it from. The confirmation
swallows the keypress that answers it, so `enter` on a confirm prompt cancels
rather than falling through to a restore.

Invoke `suspend` / `resume` from the command palette, or bind keys in
`~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+s"
type = "plugin_action"
command = "asermax.workspace-suspend.suspend"
description = "suspend workspace"

[[keys.command]]
key = "prefix+g"
type = "plugin_action"
command = "asermax.workspace-suspend.resume"
description = "resume suspended workspace"
```

## What is preserved vs. lost

- **Preserved:** workspace name & cwd, all tabs, pane layout/splits/ratios, pane
  cwds & labels, and agent conversations (via resume).
- **Lost:** running non-agent processes are killed on close and, in the common
  case, *not* restarted; terminal scrollback is not restored; pane/tab/workspace
  ids change on rebuild.

There is no native "hide" primitive in herdr, so suspending closes the
workspace — background processes do not survive while hidden.

### Why non-agent commands usually don't come back

`layout.export` reports a pane's `command` only when herdr was handed one at spawn
time — a pane built by `layout.apply` or by a config-driven layout. A pane you
opened as a shell and then typed into exports with no `command` at all, so there is
nothing for restore to replay. A dev server started by typing `npm run dev` into a
pane therefore comes back as an idle shell, not a running server.

herdr does surface the foreground command as `terminal_title` in `pane.list`, but a
scraped title isn't a trustworthy argv, so the plugin deliberately ignores it rather
than risk re-running the wrong thing.
