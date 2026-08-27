# Herdr Tab Git Status

Git branch and status in the Herdr **Spaces** sidebar that follow the *active tab*
instead of the first one.

![herdr](https://img.shields.io/badge/herdr-%3E%3D0.8.0-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## Why

Herdr's built-in `branch` and `git_status` tokens resolve against the workspace
*identity* cwd. In `src/workspace.rs`:

```rust
pub fn resolved_identity_cwd_from(&self, ...) -> Option<PathBuf> {
    self.tabs
        .first()
        .and_then(|tab| tab.cwd_for_pane(tab.root_pane, terminals, terminal_runtimes))
        .or_else(|| Some(self.identity_cwd.clone()))
}
```

`tabs.first()` and `tab.root_pane` are both fixed, so the branch shown is always
the first tab's repo. It follows a `cd` *inside* that pane, but never follows you
to another tab. That is deliberate — a Space is meant to have a stable identity —
but it is unhelpful when one Space holds two repos
([discussion #2988](https://github.com/herdrdev/herdr/discussions/2988)).

This plugin publishes `$gitbranch` and `$gitstatus` workspace tokens resolved
from the **active tab's focused pane**, using only the public
`herdr workspace report-metadata` API. Nothing is patched.

## Install

```sh
git clone https://github.com/hasuwini77/herdr-tab-git ~/dev/herdr-tab-git
herdr plugin link ~/dev/herdr-tab-git
```

Then reference the tokens in `~/.config/herdr/config.toml`:

```toml
[ui.sidebar.spaces]
rows = [
  ["state_icon", "workspace"],
  ["$gitbranch", "$gitstatus"],
]
```

```sh
herdr config check && herdr server reload-config
```

Status format is `●<dirty> ↑<ahead> ↓<behind>`, or `clean`.

## Trade-off you are accepting

These tokens **replace** the built-ins in that row, they do not fall back to
them. A Space whose active tab is not in a git repo shows nothing on that line,
where `branch`/`git_status` would still show the first tab's repo. That is the
point — but if most of your Spaces are single-repo, the built-ins are simpler
and cost nothing.

## Cost

Event-driven, no daemon. Measured hook duration on Linux:

| what | duration |
| --- | --- |
| focus event (focused workspace only) | ~170ms |
| `--all` sweep (startup / manual refresh) | ~600-800ms |

Herdr fires **both** `pane.focused` and `workspace.focused` for a single tab
switch, so the hook runs twice. That is why focus events recompute only the
focused workspace — a focus change cannot alter any other workspace's active
tab. Recomputing everything on every event cost ~820ms per hook, twice per
switch, which is what the `--all` split avoids.

Git calls are capped by `timeoutMs` (default 1500) so a huge repo or a dead
network remote can never hang a hook.

## Configuration

Optional, at `~/.config/herdr/plugins/config/hasuwini77.tab-git/config.json`
(`herdr plugin config-dir hasuwini77.tab-git`):

```json
{
  "branchToken": "gitbranch",
  "statusToken": "gitstatus",
  "cleanLabel": "clean",
  "timeoutMs": 1500,
  "enabled": true
}
```

## Actions

```sh
herdr plugin action invoke refresh --plugin hasuwini77.tab-git   # full sweep
herdr plugin action invoke clear   --plugin hasuwini77.tab-git   # drop all tokens
```

## Gotcha worth knowing

`herdr config check` does **not** honour `HERDR_CONFIG_DIR` — it always
validates your real `config.toml`. Back the file up before experimenting rather
than validating a throwaway copy; a copy will report `config: ok` even when it
contains obvious garbage.

## License

MIT © 2026 Edwin (hasuwini77)
