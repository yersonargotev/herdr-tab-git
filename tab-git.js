#!/usr/bin/env node
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ID = "yersonargotev.tab-git";
const NAMES = ["gitbranch", "gitadded", "gitmodified", "gitdeleted", "gituntracked", "gitconflicted", "gitahead", "gitbehind", "gitclean"];
const base = process.env.HERDR_CONFIG_DIR || path.join(os.homedir(), ".config", "herdr");
const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR || path.join(base, "plugins", "config", ID);
const pluginStateDir = process.env.HERDR_PLUGIN_STATE_DIR || path.join(base, "plugins", "state", ID);
const socketKey = createHash("sha256").update(process.env.HERDR_SOCKET_PATH || "default").digest("hex").slice(0, 16);
const stateDir = path.join(pluginStateDir, socketKey);
const herdrBin = process.env.HERDR_BIN_PATH || process.env.HERDR_BIN || "herdr";

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
  const counts = { added: 0, modified: 0, deleted: 0, untracked: 0, conflicted: 0 };
  const records = buffer.toString("utf8").split("\0");
  for (let i = 0; i < records.length && records[i]; i++) {
    const xy = records[i].slice(0, 2);
    if (records[i][2] !== " ") throw new Error("invalid porcelain status");
    if (/[RC]/.test(xy)) i++; // -z adds the original path after a rename/copy.
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

function tokens(info) {
  const result = { gitbranch: info.branch };
  for (const [kind, symbol] of Object.entries({ added: "+", modified: "~", deleted: "−", untracked: "?", conflicted: "!", ahead: "↑", behind: "↓" })) {
    if (info[kind]) result[`git${kind}`] = `${symbol}${info[kind]}`;
  }
  if (Object.keys(result).length === 1) result.gitclean = "clean";
  return result;
}

function snapshot(timeoutMs) {
  const r = run(herdrBin, ["api", "snapshot"], process.cwd(), timeoutMs);
  if (!r.ok) return null;
  try { return JSON.parse(r.value).result.snapshot; } catch { return null; }
}

function report(id, values, timeoutMs) {
  const args = ["workspace", "report-metadata", id, "--source", ID];
  for (const name of NAMES) args.push(values[name] === undefined ? "--clear-token" : "--token", values[name] === undefined ? name : `${name}=${values[name]}`);
  const r = run(herdrBin, args, process.cwd(), timeoutMs);
  if (!r.ok) throw new Error(`metadata update failed: ${r.error}`);
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
      try { return task(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

function refresh(wide = false, clear = false, fromWatcher = false) {
  return lock(() => {
    if (fromWatcher && fs.existsSync(path.join(stateDir, "paused"))) return true;
    const timeout = config().timeoutMs;
    const snap = snapshot(timeout);
    if (!snap) return false;
    const targets = wide || clear ? snap.workspaces || [] : (snap.workspaces || []).filter((ws) => ws.workspace_id === snap.focused_workspace_id);
    for (const ws of targets) {
      let values = {};
      if (!clear) {
        const panes = (snap.panes || []).filter((p) => p.tab_id === ws.active_tab_id);
        const pane = panes.find((p) => p.focused) || panes[0];
        const cwd = pane?.foreground_cwd || pane?.cwd;
        if (cwd) {
          const info = gitInfo(cwd, timeout);
          if (info.kind === "failure") console.error(`Git failed for ${ws.workspace_id}: ${info.error}`);
          if (info.kind === "ok") values = tokens(info);
        }
      }
      report(ws.workspace_id, values, timeout);
    }
    return true;
  });
}

function startWatcher() {
  if (fs.existsSync(path.join(stateDir, "paused"))) return;
  const dir = path.join(stateDir, "watch.lock");
  let stale = false;
  try {
    const pid = Number(fs.readFileSync(path.join(dir, "pid"), "utf8"));
    if (pid && alive(pid)) return;
    stale = Boolean(pid);
  } catch {}
  try {
    if (stale || Date.now() - fs.statSync(dir).mtimeMs > 2000) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  const child = spawn(process.execPath, [__filename, "--watch"], { detached: true, stdio: "ignore", env: process.env });
  child.unref();
}

async function watch() {
  fs.mkdirSync(stateDir, { recursive: true });
  const dir = path.join(stateDir, "watch.lock");
  try { fs.mkdirSync(dir); } catch { return; }
  fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("exit", cleanup);
  let failures = 0;
  while (!fs.existsSync(path.join(stateDir, "paused"))) {
    await new Promise((resolve) => setTimeout(resolve, config().pollMs));
    if (fs.existsSync(path.join(stateDir, "paused"))) break;
    try { failures = (await refresh(false, false, true)) ? 0 : failures + 1; } catch { failures++; }
    if (failures >= 3) break;
  }
}

async function main() {
  if (!config().enabled) return;
  if (process.argv.includes("--watch")) return watch();
  fs.mkdirSync(stateDir, { recursive: true });
  const clear = process.argv.includes("--clear");
  const wide = process.argv.includes("--all");
  if (clear) fs.writeFileSync(path.join(stateDir, "paused"), "1");
  else if (wide) fs.rmSync(path.join(stateDir, "paused"), { force: true });
  else if (fs.existsSync(path.join(stateDir, "paused"))) return;
  await refresh(wide, clear);
  if (!clear) startWatcher();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = { parseStatus, gitInfo, tokens, refresh };
