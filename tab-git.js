#!/usr/bin/env node
"use strict";
// Per-tab git branch/status for the Herdr Spaces sidebar.
//
// Herdr's built-in `branch` and `git_status` tokens resolve against the
// workspace identity cwd, which is pinned to the FIRST tab's root pane
// (src/workspace.rs, resolved_identity_cwd_from). They therefore never follow
// the active tab. These custom tokens do.
//
// Display-only: the tokens are pushed via `herdr workspace report-metadata`
// and Herdr treats them as presentation, never as workspace identity.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLUGIN_ID = "hasuwini77.tab-git";
const SOURCE = "tabgit";
const HERDR = process.env.HERDR_BIN || "herdr";

const DEFAULTS = {
  branchToken: "gitbranch",
  statusToken: "gitstatus",
  cleanLabel: "clean",
  // git can block on a huge repo or a dead network remote; never hang a hook.
  timeoutMs: 1500,
  enabled: true,
};

function loadConfig() {
  const base = process.env.HERDR_CONFIG_DIR ||
    path.join(os.homedir(), ".config", "herdr");
  try {
    const raw = JSON.parse(fs.readFileSync(
      path.join(base, "plugins", "config", PLUGIN_ID, "config.json"), "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

const cfg = loadConfig();

function run(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, {
      cwd, encoding: "utf8", timeout: cfg.timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return ""; }
}
const git = (args, cwd) => run("git", args, cwd);
const herdr = (args) => run(HERDR, args, process.cwd());

const clearFor = (wsId) => herdr([
  "workspace", "report-metadata", wsId, "--source", SOURCE,
  "--clear-token", cfg.branchToken, "--clear-token", cfg.statusToken,
]);

function snapshot() {
  const out = herdr(["api", "snapshot"]);
  if (!out) return null;
  try { return JSON.parse(out).result.snapshot; } catch { return null; }
}

function main() {
  if (!cfg.enabled) return;
  const snap = snapshot();
  if (!snap) return; // socket not ready (startup race); a later event retries

  const clearing = process.argv.includes("--clear");
  const panes = snap.panes || [];

  // A focus event can only change the active tab of the workspace that is
  // focused; every other workspace keeps the tab it had. Recomputing all of
  // them costs ~800ms per hook, and Herdr fires both pane.focused and
  // workspace.focused for a single tab switch, so it would be paid twice.
  // --all is for the startup hook and the manual refresh action.
  const wide = clearing || process.argv.includes("--all");
  const targets = wide
    ? (snap.workspaces || [])
    : (snap.workspaces || []).filter((w) => w.workspace_id === snap.focused_workspace_id);

  for (const ws of targets) {
    if (clearing) { clearFor(ws.workspace_id); continue; }

    // Active tab -> its focused pane -> that pane's live cwd.
    const inTab = panes.filter((p) => p.tab_id === ws.active_tab_id);
    const pane = inTab.find((p) => p.focused) || inTab[0];
    // foreground_cwd follows a plain `cd`; cwd is only the launch directory.
    const cwd = pane && (pane.foreground_cwd || pane.cwd);

    // Not a repo (or git unavailable): clear rather than leave a stale branch.
    if (!cwd || !git(["rev-parse", "--show-toplevel"], cwd)) {
      clearFor(ws.workspace_id);
      continue;
    }

    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd) || "detached";
    const dirty = git(["status", "--porcelain"], cwd).split("\n").filter(Boolean).length;
    // Empty when there is no upstream; treat that as 0/0 rather than failing.
    const counts = git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd);
    const [behind, ahead] = counts ? counts.split(/\s+/) : ["0", "0"];

    const status = [
      dirty ? `●${dirty}` : "",
      Number(ahead) ? `↑${ahead}` : "",
      Number(behind) ? `↓${behind}` : "",
    ].filter(Boolean).join(" ") || cfg.cleanLabel;

    herdr(["workspace", "report-metadata", ws.workspace_id, "--source", SOURCE,
           "--token", `${cfg.branchToken}=${branch}`,
           "--token", `${cfg.statusToken}=${status}`]);
  }
}

main();
