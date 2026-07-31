# herdr-suspend-workspace

A [herdr](https://herdr.dev) plugin that **suspends** a workspace: snapshots its tabs,
pane layout, and agent conversations, then closes it so it (and its agents)
disappear from the sidebar. Restore it later from a popup picker — the layout is
rebuilt and agents resume their conversations.

## How it works

- **Suspend** captures the workspace via `layout.export` (per tab) and
  `pane.list` (for each pane's agent session), stores a snapshot under
  `HERDR_PLUGIN_STATE_DIR/suspended/`, then calls `workspace.close`.
- **Restore** creates a fresh workspace and replays each tab with `layout.apply`.
  Agent panes are relaunched with their resume argv (e.g. `claude --resume <id>`,
  `pi --session <id>`), so conversations resume. The original non-agent pane
  commands are replayed too (e.g. a dev server restarts).

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
| `picker` | popup pane | Interactive list with search; `enter` restores, `esc` cancels |

### Picker keys

| Key | Mode | Action |
| --- | --- | --- |
| `↑`/`↓`, `j`/`k`, `ctrl+p`/`ctrl+n` | both | move selection |
| `enter` | browse | restore the selected workspace |
| `/` | browse | start searching (matches label and cwd) |
| `enter` | search | keep the filter and go back to browsing |
| `esc` | search | discard the edit, back to the previous filter |
| `ctrl+u` | both | clear the filter |
| `esc`, `ctrl+c` | browse | close the popup |

The search is token-based: `lay adm` matches a workspace whose label or cwd
contains both `lay` and `adm`.

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
- **Lost:** running non-agent processes are killed on close and replayed as fresh
  commands; terminal scrollback is not restored; pane/tab/workspace ids change on
  rebuild.

There is no native "hide" primitive in herdr, so suspending closes the
workspace — background processes do not survive while hidden.
