# Herdr Tab Git Tokens

An independently maintained Herdr plugin based on [hasuwini77/herdr-tab-git](https://github.com/hasuwini77/herdr-tab-git). It publishes the active tab name and compact Git tokens for each Space, using that tab's focused pane and live `foreground_cwd`. It also publishes each pane's project for the Agents sidebar. The original MIT license and Edwin's copyright remain in [LICENSE](LICENSE).

Herdr's built-in `branch` and `git_status` use a Space's identity directory. These tokens follow the active tab, including the last active tab in an inactive Space. Herdr 0.9.5 or newer, Node.js and Git are required on macOS or Linux.

## Install

```sh
herdr plugin install yersonargotev/herdr-tab-git
# For a local checkout: herdr plugin link /path/to/herdr-tab-git
herdr plugin action invoke refresh --plugin yersonargotev.tab-git
```

The refresh action populates tokens immediately after linking or installing. Startup refreshes both Space and pane tokens. Focus and pane lifecycle hooks refresh Space tokens and every pane project. Herdr supplies `HERDR_BIN_PATH`; the plugin uses it when present.

Use the same Git vocabulary as the dots-managed Starship prompt:

```toml
[ui.sidebar.spaces]
rows = [
  ["state_icon", { token = "$tab_name", fg = "#cdd6f4", bold = true }],
  [{ token = "$gitbranch", fg = "#cba6f7", bold = true },
   { token = "$gitstaged", fg = "#a6e3a1" },
   { token = "$gitworkmodified", fg = "#f9e2af" },
   { token = "$gituntracked", fg = "#f38ba8" },
   { token = "$gitforward", fg = "#94e2d5" },
   { token = "$gitbackward", fg = "#fab387" },
   { token = "$gitdiverged", fg = "#cba6f7" },
   { token = "$gitclean", fg = "#6c7086" }],
]
```

Version 1.2 adds prompt-oriented status tokens. Branch names remain unprefixed. The original
path-category tokens and counts remain available. Colors belong to the consumer;
the example matches Catppuccin Mocha. A clean repository shows its branch and the original `clean` indicator.

`$tab_name` contains the active tab label without a prefix, even outside a Git repository. Each Git category is a separate token, so Herdr can style it independently. Omit less useful token names from the row if your sidebar is very narrow. The plugin still maintains the full token set.

## Show each agent's project

Add these rows to `~/.config/herdr/config.toml`. The plugin does not edit your configuration.

```toml
[ui.sidebar.agents]
rows = [
	["state_icon", "agent"],
	[{ token = "$project", fg = "#6c7086" }],
]
```

Run the refresh action after you add the rows. On Herdr 0.9.5, each Agents row consumes its own pane's `$project` token. A Workspace named `dots` can show agents in `dots` and `herdr-tab-git`, including two panes in the same tab.

The project uses `foreground_cwd` when available, then `cwd`. In Git, the label is the checkout root basename, even from a subdirectory. A linked worktree uses its own root name. Outside Git, or when root discovery fails or times out, the label is the selected directory basename. If neither directory exists in the snapshot, the plugin clears the token and the project row disappears. Spaces in names remain intact. Different roots with the same basename intentionally show the same label.

Root discovery runs independently of Git status and upstream inspection. A successful root lookup still supplies the project when those other commands fail. Space Git tokens retain their failure-clearing behavior.

Startup, events, and polling update every snapshot pane, including inactive tabs and Workspaces. The watcher renews `$project` even when its value is unchanged. Project metadata has a finite lifetime, so labels expire after the producer stops. The lifetime is three times the sum of the configured poll interval and a conservative bound for a full serial refresh, capped at 24 hours. It accounts for the snapshot, Space scans, distinct pane directories, and metadata writes. A failed lookup falls back to the reported directory name. A failed metadata write or a disappearing pane does not prevent other targets from updating.

## Space tokens

| Token | Value | Meaning |
| --- | --- | --- |
| `$tab_name` | `codex · dots` | Active tab label |
| `$gitbranch` | `main`, `detached@abc1234` | Branch or detached commit |
| `$gitstaged` | `+2` | Index additions, modifications, and type changes |
| `$gitworkmodified` | `!2` | Worktree modifications or intent-to-add paths |
| `$gitforward` | `⇡2` | Ahead only |
| `$gitbackward` | `⇣2` | Behind only |
| `$gitdiverged` | `⇕⇡2⇣3` | Both ahead and behind; excludes the two prompt arrows |
| `$gitadded` | `+2` | Added paths |
| `$gitmodified` | `~2` | Modified or renamed paths |
| `$gitdeleted` | `−2` | Deleted paths |
| `$gituntracked` | `?2` | Untracked paths |
| `$gitconflicted` | `!2` | Unmerged paths |
| `$gitahead` | `↑2` | Commits ahead of upstream |
| `$gitbehind` | `↓2` | Commits behind upstream |
| `$gitclean` | `clean` | Successful status with all counts zero |

Only nonzero categories are published. Each Git path contributes to one category, even when it has both staged and unstaged changes. The precedence is conflict, deletion, addition, modification. A staged addition with a later unstaged edit is added; a staged and unstaged modification is modified. A rename is one modified destination path; Git's old path is consumed but not counted again. An untracked directory is expanded into paths. Git's NUL delimited porcelain v1 format handles whitespace, quotes, and newlines in names. A missing upstream means zero ahead and behind. A failed or timed out Git command clears its tokens; it never produces `clean`.

## Configuration and actions

Optional `config.json` goes in `herdr plugin config-dir yersonargotev.tab-git` (normally `~/.config/herdr/plugins/config/yersonargotev.tab-git/`):

```json
{ "enabled": true, "timeoutMs": 1500, "pollMs": 3000 }
```

`timeoutMs` is clamped to 100–10000 ms and `pollMs` to 1000–60000 ms. Git calls and Herdr CLI calls use timeouts. No shell interpolation or runtime network calls are used.

```sh
herdr plugin action invoke refresh --plugin yersonargotev.tab-git
herdr plugin action invoke clear --plugin yersonargotev.tab-git
```

`refresh` scans every Space and pane, then resumes automatic updates. Startup and automatic events respect a previous pause. `clear` removes this plugin's Space tokens and pane project tokens. It pauses automatic updates until `refresh`. Other metadata remains intact.

## Refresh cost and limits

Herdr plugin hooks have no directory-change event, and startup hooks are one-shot ([Herdr plugin documentation](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/plugins.mdx)). The plugin starts one detached watcher per Herdr socket. It polls the focused Space and all pane projects at the configured interval, which defaults to three seconds. This interval is nominal. Serial commands and lock waits can delay visible updates.

Each poll reads one snapshot, runs the focused Space's Git commands, and updates its metadata. It also runs one root-only lookup per distinct pane directory and updates each pane's project metadata. Inactive panes do not receive full Git-status scans merely to discover their projects. Startup, wide tab events, and explicit refresh scan all Spaces. Inactive Space Git tokens retain their existing refresh behavior.

The same per-session lock serializes snapshot reads, metadata writes, and pause transitions. Overlapping refreshes read a fresh snapshot after they obtain the lock. `clear` pauses automatic publication until explicit `refresh`, including wide automatic events. The watcher exits after three failed Herdr snapshots or a pause. A failed write for one target does not end a reachable watcher. A watcher crash stops renewal, so project labels expire. A later hook or explicit refresh starts the watcher again.

Run tests with `node --test test/*.test.js`. Set `STARSHIP_CONFIG` to the absolute
path of the dots-managed Starship config to also compare rendered modules in
temporary repositories (requires Starship on PATH). Tests use temporary Git repos and a fake Herdr CLI.

## License

MIT © 2026 Edwin (hasuwini77). Fork changes © 2026 Yerson Argote.
