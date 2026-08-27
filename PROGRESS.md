# Progress

## 2026-08-27 — per-tab git status in the Spaces sidebar

**Wanted:** herdr discussion #2988 asked why `branch`/`git_status` in the Spaces
sidebar only ever reflect the first tab when a Space holds two git repos.

**Cause:** not "workspace-scoped" in the loose sense — it is specifically the
first tab's *root pane*. `resolved_identity_cwd_from` in `src/workspace.rs` does
`self.tabs.first().and_then(|tab| tab.cwd_for_pane(tab.root_pane, ...))`. Both
are fixed, which is why it tracks a `cd` inside tab 1 yet ignores tab 2. Stable
Space identity is the design intent.

**Fix:** publish `$gitbranch` / `$gitstatus` workspace tokens resolved from
`workspace.active_tab_id` -> that tab's focused pane -> its `foreground_cwd`
(which follows `cd`, unlike `cwd`), via `herdr workspace report-metadata`.

**Verified:** one Space with two tabs on different repos, switching tabs with no
manual run — `master`/`clean` and `main`/`●4`, flipping correctly both ways.
`herdr plugin log` confirms the `pane.focused` / `workspace.focused` hooks fired
and exited 0.

**Two things measurement changed:**

- `herdr plugin link` does **not** validate event names — it happily accepted
  `totally.bogus.event`. So a successful link proves nothing about whether a
  hook will fire; only the plugin log does.
- Both `pane.focused` and `workspace.focused` fire for one tab switch, and the
  first implementation recomputed git for every workspace at ~820ms per hook.
  Since a focus change cannot alter another workspace's active tab, focus events
  now recompute only the focused workspace: ~170ms. Full sweeps are `--all`,
  used by the startup hook and the manual refresh action.

**Also learned:** `herdr config check` ignores `HERDR_CONFIG_DIR` and always
validates the real `config.toml`. A throwaway copy reports `config: ok` even
when it holds obvious garbage, so validation must be done against the real file
with a backup.
