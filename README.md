# Herdr Tab Git Tokens

An independently maintained Herdr plugin based on [hasuwini77/herdr-tab-git](https://github.com/hasuwini77/herdr-tab-git). It publishes compact Git tokens for each Space's active tab, using that tab's focused pane and live `foreground_cwd`. The original MIT license and Edwin's copyright remain in [LICENSE](LICENSE).

Herdr's built-in `branch` and `git_status` use a Space's identity directory. These tokens follow the active tab, including the last active tab in an inactive Space. Herdr 0.9.1 or newer, Node.js and Git are required on macOS or Linux.

## Install

```sh
herdr plugin install yersonargotev/herdr-tab-git
# For a local checkout: herdr plugin link /path/to/herdr-tab-git
herdr plugin action invoke refresh --plugin yersonargotev.tab-git
```

The refresh action populates tokens immediately after linking or installing. Startup and focus hooks also refresh them. Herdr supplies `HERDR_BIN_PATH`; the plugin uses it when present.

Add a compact second row to `~/.config/herdr/config.toml`:

```toml
[ui.sidebar.spaces]
rows = [
  ["state_icon", "workspace"],
  [{ token = "$gitbranch", fg = "#89dceb" },
   { token = "$gitconflicted", fg = "#cba6f7" },
   { token = "$gitadded", fg = "#a6e3a1" },
   { token = "$gitmodified", fg = "#f9e2af" },
   { token = "$gitdeleted", fg = "#f38ba8" },
   { token = "$gituntracked", fg = "#89b4fa" },
   { token = "$gitahead", fg = "#94e2d5" },
   { token = "$gitbehind", fg = "#fab387" },
   { token = "$gitclean", fg = "#6c7086" }],
]
```

Each category is a separate token, so Herdr can style it independently. Omit less useful token names from the row if your sidebar is very narrow. The plugin still maintains the full token set.

| Token | Value | Meaning |
| --- | --- | --- |
| `$gitbranch` | `main`, `detached@abc1234` | Branch or detached commit |
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

`refresh` scans every Space and resumes automatic updates. `clear` removes every token and pauses automatic updates until `refresh`.

## Refresh cost and limits

Herdr plugin hooks have no file change event, and startup hooks are one-shot ([Herdr plugin documentation](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/plugins.mdx)). The plugin starts one detached watcher per Herdr socket. It polls only the currently focused Space every three seconds, with serial Git reads and metadata writes. Focus hooks refresh immediately; startup and explicit refresh scan all Spaces. The watcher exits after three failed Herdr snapshots or when `clear` pauses it. Each poll costs one snapshot, up to five Git commands, and one metadata update. A large repository can delay a poll up to the configured command timeouts. Inactive Spaces update on startup, explicit refresh, and when focused; file changes in them can remain stale until then. An unexpected watcher crash can leave file changes stale until the next focus hook or manual refresh.

Run tests with `node --test test/*.test.js`. Tests use temporary Git repos and a fake Herdr CLI.

## License

MIT © 2026 Edwin (hasuwini77). Fork changes © 2026 Yerson Argote.
