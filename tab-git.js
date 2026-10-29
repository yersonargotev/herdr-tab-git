#!/usr/bin/env node
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ID = "yersonargotev.tab-git";
const TOKEN_NAMES = {
  workspace: ["tab_name", "gitbranch", "gitadded", "gitmodified", "gitdeleted", "gituntracked", "gitconflicted", "gitahead", "gitbehind", "gitclean", "gitstaged", "gitworkmodified", "gitforward", "gitbackward", "gitdiverged"],
  pane: ["project"],
};
const base = process.env.HERDR_CONFIG_DIR || path.join(os.homedir(), ".config", "herdr");
const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR || path.join(base, "plugins", "config", ID);
const pluginStateDir = process.env.HERDR_PLUGIN_STATE_DIR || path.join(base, "plugins", "state", ID);
const socketKey = createHash("sha256").update(process.env.HERDR_SOCKET_PATH || "default").digest("hex").slice(0, 16);
const stateDir = path.join(pluginStateDir, socketKey);
const herdrBin = process.env.HERDR_BIN_PATH || process.env.HERDR_BIN || "herdr";
// Installation paths change on update; the digest also covers in-place edits.
const watcherIdentity = createHash("sha256").update(__filename).update(fs.readFileSync(__filename)).digest("hex");

function config() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8")); } catch {}
  return {
    enabled: user.enabled !== false,
    timeoutMs: Number.isInteger(user.timeoutMs) ? Math.max(100, Math.min(10000, user.timeoutMs)) : 1500,
    pollMs: Number.isInteger(user.pollMs) ? Math.max(1000, Math.min(60000, user.pollMs)) : 3000,
  };
}

function run(bin, args, cwd, timeoutMs, encoding = "utf8") {
  const r = spawnSync(bin, args, { cwd, encoding, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return r.error || r.status !== 0
    ? { ok: false, timeout: r.error?.code === "ETIMEDOUT", error: r.error?.message || String(r.stderr || "").trim() }
    : { ok: true, value: r.stdout };
}

function parseStatus(buffer) {
  const counts = { added: 0, modified: 0, deleted: 0, untracked: 0, conflicted: 0, staged: 0, workmodified: 0 };
  const records = buffer.toString("utf8").split("\0");
  for (let i = 0; i < records.length && records[i]; i++) {
    const xy = records[i].slice(0, 2);
    if (records[i][2] !== " ") throw new Error("invalid porcelain status");
    if (/[RC]/.test(xy)) i++; // -z adds the original path after a rename/copy.
    const conflicted = /U/.test(xy) || xy === "AA" || xy === "DD";
    // Match Starship's staged and modified modules, independently of path categories.
    if (!conflicted && xy !== "??") {
      if (/[AMT]/.test(xy[0])) counts.staged++;
      if (/[AM]/.test(xy[1])) counts.workmodified++;
    }
    if (xy === "??") counts.untracked++;
    else if (/U/.test(xy) || xy === "AA" || xy === "DD") counts.conflicted++;
    else if (xy.includes("D")) counts.deleted++;
    else if (xy.includes("A") || xy.includes("C")) counts.added++;
    else counts.modified++;
  }
  return counts;
}

function gitInfo(cwd, timeoutMs) {
  const git = (args, encoding) => run("git", args, cwd, timeoutMs, encoding);
  const root = git(["rev-parse", "--show-toplevel"]);
  if (!root.ok) return { kind: /not a git repository/i.test(root.error) ? "outside" : "failure", error: root.error };
  const named = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  let branch = named.ok ? named.value.trim() : "";
  if (!branch) {
    const head = git(["rev-parse", "--short", "HEAD"]);
    if (!head.ok) return { kind: "failure", error: head.error };
    branch = `detached@${head.value.trim()}`;
  }
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], "buffer");
  if (!status.ok) return { kind: "failure", error: status.error };
  let counts;
  try { counts = parseStatus(status.value); } catch (e) { return { kind: "failure", error: e.message }; }
  let ahead = 0, behind = 0;
  const upstream = git(["rev-parse", "--verify", "@{upstream}"]);
  if (!upstream.ok && !/no upstream configured|no such branch|does not have any commits yet|HEAD does not point to a branch/i.test(upstream.error)) {
    return { kind: "failure", error: upstream.error };
  }
  if (upstream.ok) {
    const delta = git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
    if (!delta.ok) return { kind: "failure", error: delta.error };
    const match = delta.value.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) return { kind: "failure", error: "invalid divergence counts" };
    behind = Number(match[1]); ahead = Number(match[2]);
  }
  return { kind: "ok", branch, ...counts, ahead, behind };
}

function projectName(cwd, timeoutMs) {
  if (!cwd) return undefined;
  const root = run("git", ["rev-parse", "--show-toplevel"], cwd, timeoutMs);
  return path.basename(root.ok ? root.value.replace(/\n$/, "") : cwd);
}

function tokens(info) {
  const result = { gitbranch: info.branch };
  for (const [kind, symbol] of Object.entries({ added: "+", modified: "~", deleted: "−", untracked: "?", conflicted: "!", ahead: "↑", behind: "↓" })) {
    if (info[kind]) result[`git${kind}`] = `${symbol}${info[kind]}`;
  }
  if (info.staged) result.gitstaged = `+${info.staged}`;
  if (info.workmodified) result.gitworkmodified = `!${info.workmodified}`;
  if (info.ahead && info.behind) result.gitdiverged = `⇕⇡${info.ahead}⇣${info.behind}`;
  else if (info.ahead) result.gitforward = `⇡${info.ahead}`;
  else if (info.behind) result.gitbackward = `⇣${info.behind}`;
  if (Object.keys(result).length === 1) result.gitclean = "clean";
  return result;
}

function snapshot(timeoutMs) {
  const r = run(herdrBin, ["api", "snapshot"], process.cwd(), timeoutMs);
  if (!r.ok) return null;
  try { return JSON.parse(r.value).result.snapshot; } catch { return null; }
}

function report(scope, id, values, timeoutMs, ttlMs) {
  const args = [scope, "report-metadata", id, "--source", ID];
  for (const name of TOKEN_NAMES[scope]) args.push(values[name] === undefined ? "--clear-token" : "--token", values[name] === undefined ? name : `${name}=${values[name]}`);
  if (ttlMs !== undefined) args.push("--ttl-ms", String(ttlMs));
  const r = run(herdrBin, args, process.cwd(), timeoutMs);
  if (!r.ok) console.error(`metadata update failed for ${scope} ${id}: ${r.error}`);
  return r.ok;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

async function lock(task) {
  fs.mkdirSync(stateDir, { recursive: true });
  const dir = path.join(stateDir, "update.lock");
  for (let i = 0; i < 100; i++) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
      try { return await task(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let pid = 0;
      try { pid = Number(fs.readFileSync(path.join(dir, "pid"), "utf8")); } catch {}
      let age = 0;
      try { age = Date.now() - fs.statSync(dir).mtimeMs; } catch { continue; }
      if ((pid && !alive(pid)) || (!pid && age > 2000)) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("update lock timed out");
}

function refresh(request = { kind: "automatic", wide: false }) {
  return lock(() => {
    const paused = path.join(stateDir, "paused");
    const clear = request.kind === "clear";
    if (clear) fs.writeFileSync(paused, "1");
    else if (request.kind === "resume") fs.rmSync(paused, { force: true });
    else if (fs.existsSync(paused)) return true;
    const settings = config();
    const timeout = settings.timeoutMs;
    const snap = snapshot(timeout);
    if (!snap) return false;
    const targets = request.wide || clear ? snap.workspaces || [] : (snap.workspaces || []).filter((ws) => ws.workspace_id === snap.focused_workspace_id);
    for (const ws of targets) {
      let values = {};
      if (!clear) {
        const tab = (snap.tabs || []).find((tab) => tab.tab_id === ws.active_tab_id);
        const label = tab?.label?.trim();
        if (label) values.tab_name = label;
        const panes = (snap.panes || []).filter((p) => p.tab_id === ws.active_tab_id);
        const pane = panes.find((p) => p.focused) || panes[0];
        const cwd = pane?.foreground_cwd || pane?.cwd;
        if (cwd) {
          const info = gitInfo(cwd, timeout);
          if (info.kind === "failure") console.error(`Git failed for ${ws.workspace_id}: ${info.error}`);
          if (info.kind === "ok") Object.assign(values, tokens(info));
        }
      }
      report("workspace", ws.workspace_id, values, timeout);
    }
    const panes = snap.panes || [];
    const directories = new Set(panes.map((pane) => pane.foreground_cwd || pane.cwd).filter(Boolean));
    const sweepCommands = 1 + 7 * (snap.workspaces || []).length + directories.size + panes.length;
    const ttlMs = Math.min(86400000, 3 * (settings.pollMs + timeout * sweepCommands));
    const projects = new Map();
    for (const pane of panes) {
      const cwd = pane.foreground_cwd || pane.cwd;
      if (!clear && !projects.has(cwd)) projects.set(cwd, projectName(cwd, timeout));
      report("pane", pane.pane_id, clear ? {} : { project: projects.get(cwd) }, timeout, clear ? undefined : ttlMs);
    }
    return true;
  });
}

function isPluginWatcher(pid) {
  // A lock may outlive its process and its PID may be reused. Check the actual
  // command and adjacent manifest before signalling even a legacy watcher.
  const command = run("ps", ["-p", String(pid), "-o", "command="], process.cwd(), 1500);
  const match = command.ok && command.value.trim().match(/^(.+?\/node|node) (.+) --watch$/);
  if (!match || path.basename(match[1]) !== "node" || path.basename(match[2]) !== "tab-git.js") return false;
  try {
    return /^id = "yersonargotev\.tab-git"$/m.test(fs.readFileSync(path.join(path.dirname(match[2]), "herdr-plugin.toml"), "utf8"));
  } catch { return false; }
}

async function startWatcher() {
  // Serialize replacement with publications and other hooks. In particular,
  // wait for legacy exit handlers to remove their lock before creating ours.
  return lock(async () => {
    if (fs.existsSync(path.join(stateDir, "paused"))) return;
    const dir = path.join(stateDir, "watch.lock");
    let stale = false;
    try {
      const pid = Number(fs.readFileSync(path.join(dir, "pid"), "utf8"));
      stale = Boolean(pid);
      if (pid && alive(pid)) {
        let identity;
        try { identity = fs.readFileSync(path.join(dir, "identity"), "utf8"); } catch {}
        if (identity === watcherIdentity || !isPluginWatcher(pid)) return;
        process.kill(pid, "SIGTERM");
        const deadline = Date.now() + 5000;
        while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
        if (alive(pid)) throw new Error("previous watcher did not exit");
      }
    } catch (e) { if (e.code !== "ENOENT" && e.code !== "ESRCH") throw e; }
    try {
      if (stale || Date.now() - fs.statSync(dir).mtimeMs > 2000) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    const child = spawn(process.execPath, [__filename, "--watch"], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
    // Wait for ownership before allowing the next hook to inspect the lock.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        const pid = Number(fs.readFileSync(path.join(dir, "pid"), "utf8"));
        if (pid === child.pid && fs.readFileSync(path.join(dir, "identity"), "utf8") === watcherIdentity) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("watcher did not start");
  });
}

async function watch() {
  fs.mkdirSync(stateDir, { recursive: true });
  const dir = path.join(stateDir, "watch.lock");
  try { fs.mkdirSync(dir); } catch { return; }
  fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
  fs.writeFileSync(path.join(dir, "identity"), watcherIdentity);
  const cleanup = () => {
    try {
      if (Number(fs.readFileSync(path.join(dir, "pid"), "utf8")) === process.pid) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  };
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("exit", cleanup);
  let failures = 0;
  while (!fs.existsSync(path.join(stateDir, "paused"))) {
    await new Promise((resolve) => setTimeout(resolve, config().pollMs));
    if (fs.existsSync(path.join(stateDir, "paused"))) break;
    try { failures = (await refresh()) ? 0 : failures + 1; } catch { failures++; }
    if (failures >= 3) break;
  }
  cleanup();
  if (failures < 3) await startWatcher();
}

async function main() {
  if (!config().enabled) return;
  if (process.argv.includes("--watch")) return watch();
  fs.mkdirSync(stateDir, { recursive: true });
  const kind = process.argv.includes("--clear") ? "clear" : process.argv.includes("--resume") ? "resume" : "automatic";
  await refresh({ kind, wide: kind !== "automatic" || process.argv.includes("--all") });
  if (kind !== "clear") await startWatcher();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = { parseStatus, gitInfo, tokens, refresh };
