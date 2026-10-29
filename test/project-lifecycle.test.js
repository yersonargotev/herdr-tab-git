"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync, spawn, spawnSync } = require("node:child_process");

const pluginDir = path.join(__dirname, "..");
const manifest = fs.readFileSync(path.join(pluginDir, "herdr-plugin.toml"), "utf8");
const startup = JSON.parse(manifest.match(/\[\[startup\]\]\s*command = (\[[^\n]+\])/)[1]);
const actions = Object.fromEntries([...manifest.matchAll(/\[\[actions\]\]\s*id = "([^"]+)"[^]*?command = (\[[^\n]+\])/g)].map((m) => [m[1], JSON.parse(m[2])]));
const events = [...manifest.matchAll(/\[\[events\]\]\s*on = "([^"]+)"\s*command = (\[[^\n]+\])/g)].map((m) => ({name: m[1], command: JSON.parse(m[2])}));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually(check, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(100);
  }
  assert.ok(check(), message);
}

function fixture(t, polling = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "project-lifecycle-"));
  const config = path.join(dir, "config");
  const stateRoot = path.join(dir, "plugin-state");
  const socket = path.join(dir, "session.sock");
  fs.mkdirSync(config);
  fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({timeoutMs: 500, pollMs: 1000}));
  const stateDir = path.join(stateRoot, createHash("sha256").update(socket).digest("hex").slice(0, 16));
  const watchLock = path.join(stateDir, "watch.lock");
  if (!polling) {
    fs.mkdirSync(watchLock, {recursive: true});
    fs.writeFileSync(path.join(watchLock, "pid"), String(process.pid));
  }
  const file = path.join(dir, "snapshot.json");
  const control = path.join(dir, "control.json");
  const output = path.join(dir, "metadata");
  fs.mkdirSync(output);
  const bin = path.join(dir, "herdr");
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const a = process.argv.slice(2);
const root = process.env.FAKE_ROOT;
const c = JSON.parse(fs.readFileSync(path.join(root, 'control.json')));
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'snapshot.json')));
function log(value) { fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(value) + '\\n'); }
if (a[0] === 'api') {
  log({kind: 'snapshot', snapshot});
  if (c.snapshotFailure) process.exit(1);
  console.log(JSON.stringify({result: {snapshot}}));
  process.exit(0);
}
const [scope, command, id, source, producer] = a;
assert.equal(command, 'report-metadata');
assert.equal(source, '--source');
assert.equal(producer, 'yersonargotev.tab-git');
log({kind: 'report', scope, id});
if (c.hold === scope + ':' + id) {
  fs.writeFileSync(path.join(root, 'held'), '1');
  const deadline = Date.now() + 400;
  while (!fs.existsSync(path.join(root, 'release')) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}
if ((c.fail || []).includes(scope + ':' + id)) process.exit(1);
const latest = JSON.parse(fs.readFileSync(path.join(root, 'snapshot.json')));
if (c.closeOnReport === id) {
  latest.panes = latest.panes.filter((pane) => pane.pane_id !== id);
  fs.writeFileSync(path.join(root, 'snapshot.json.tmp'), JSON.stringify(latest));
  fs.renameSync(path.join(root, 'snapshot.json.tmp'), path.join(root, 'snapshot.json'));
}
assert.ok((scope === 'pane' ? latest.panes : latest.workspaces).some(item => item[scope + '_id'] === id));
const file = path.join(root, 'metadata', encodeURIComponent(scope + ':' + id) + '.json');
let values = {};
try { values = JSON.parse(fs.readFileSync(file)); } catch {}
const ttlAt = a.indexOf('--ttl-ms');
const ttl = ttlAt < 0 ? null : Number(a[ttlAt + 1]);
if (scope === 'pane' && a.includes('--token')) assert.ok(ttl > 0 && ttl <= 86400000);
if (scope === 'workspace') assert.equal(ttl, null);
for (let i = 5; i < a.length; i += 2) {
  if (a[i] === '--ttl-ms') continue;
  assert.ok(['--token', '--clear-token'].includes(a[i]));
  const at = a[i + 1].indexOf('=');
  const name = a[i] === '--token' ? a[i + 1].slice(0, at) : a[i + 1];
  if (a[i] === '--token') values[name] = {value: a[i + 1].slice(at + 1), source: producer, written: Date.now(), expires: ttl ? Date.now() + ttl : null};
  else delete values[name];
}
fs.writeFileSync(file + '.' + process.pid, JSON.stringify(values));
fs.renameSync(file + '.' + process.pid, file);
`);
  fs.chmodSync(bin, 0o755);
  const env = {...process.env, HERDR_BIN_PATH: bin, HERDR_PLUGIN_CONFIG_DIR: config, HERDR_PLUGIN_STATE_DIR: stateRoot, HERDR_SOCKET_PATH: socket, FAKE_ROOT: dir};
  const snapshot = {focused_workspace_id: "w1", workspaces: [{workspace_id: "w1", active_tab_id: "t1"}, {workspace_id: "w2", active_tab_id: "t3"}], tabs: [{tab_id: "t1", label: "active"}, {tab_id: "t2", label: "inactive"}, {tab_id: "t3", label: "background"}], panes: []};
  const write = (target, value) => { fs.writeFileSync(target + ".tmp", JSON.stringify(value)); fs.renameSync(target + ".tmp", target); };
  const save = () => write(file, snapshot);
  const setControl = (value) => write(control, value);
  const records = () => {
    try { return fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch { return []; }
  };
  const raw = (scope, id) => {
    try { return JSON.parse(fs.readFileSync(path.join(output, encodeURIComponent(`${scope}:${id}`) + ".json"))); } catch { return {}; }
  };
  const read = (scope, id) => Object.fromEntries(Object.entries(raw(scope, id)).filter(([, entry]) => !entry.expires || entry.expires > Date.now()).map(([key, entry]) => [key, entry.value]));
  const invoke = (command) => {
    const r = spawnSync(command[0], [path.join(pluginDir, command[1]), ...command.slice(2)], {env, encoding: "utf8", timeout: 20000});
    assert.equal(r.status, 0, r.stderr || String(r.error));
    return r;
  };
  const launch = (command) => {
    const child = spawn(command[0], [path.join(pluginDir, command[1]), ...command.slice(2)], {env, stdio: ["ignore", "pipe", "pipe"]});
    const result = new Promise((resolve, reject) => {
      let error = "";
      child.stderr.on("data", (chunk) => { error += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => { code === 0 ? resolve() : reject(new Error(error)); });
    });
    return {child, result};
  };
  const stop = async () => {
    let pid;
    const ownedState = path.join(env.HERDR_PLUGIN_STATE_DIR, createHash("sha256").update(env.HERDR_SOCKET_PATH).digest("hex").slice(0, 16));
    try { pid = Number(fs.readFileSync(path.join(ownedState, "watch.lock", "pid"), "utf8")); } catch { return; }
    if (pid === process.pid) return;
    try { process.kill(pid, "SIGTERM"); } catch {}
    await eventually(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "owned watcher exits", 5000);
  };
  t.after(async () => { await stop(); fs.rmSync(dir, {recursive: true, force: true}); });
  const repo = (name) => {
    const cwd = path.join(dir, name);
    fs.mkdirSync(cwd, {recursive: true});
    for (const args of [["init", "-q"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.com"]]) execFileSync("git", args, {cwd});
    fs.writeFileSync(path.join(cwd, "base"), "base\n");
    execFileSync("git", ["add", "."], {cwd}); execFileSync("git", ["commit", "-qm", "base"], {cwd});
    return cwd;
  };
  const pane = (id, tab, cwd) => ({pane_id: id, tab_id: tab, cwd, agent: "codex"});
  save(); setControl({});
  return {dir, env, snapshot, save, setControl, raw, read, records, invoke, launch, stop, repo, pane};
}

test("events update every pane project and all automatic hooks respect clear", (t) => {
  const f = fixture(t);
  const first = f.repo("first"), second = f.repo("second");
  f.snapshot.panes = [f.pane("w1:p1", "t1", first), f.pane("w1:p2", "t2", first), f.pane("w2:p1", "t3", first)];
  f.save(); f.invoke(startup);
  f.snapshot.panes[1].foreground_cwd = second;
  f.snapshot.panes[2].cwd = second;
  f.save(); f.invoke(events.find((e) => e.name === "pane.focused").command);
  assert.equal(f.read("pane", "w1:p2").project, "second");
  assert.equal(f.read("pane", "w2:p1").project, "second");
  assert.equal(f.read("pane", "w1:p1").project, "first");
  assert.equal(f.read("workspace", "w2").gitbranch, f.read("workspace", "w1").gitbranch);
  for (const event of events) {
    f.snapshot.panes[1].foreground_cwd = f.snapshot.panes[1].foreground_cwd === first ? second : first;
    f.save(); f.invoke(event.command);
    assert.equal(f.read("pane", "w1:p2").project, path.basename(f.snapshot.panes[1].foreground_cwd), event.name);
  }
  f.invoke(actions.clear);
  for (const event of events) f.invoke(event.command);
  f.invoke(startup);
  for (const pane of f.snapshot.panes) assert.equal(f.read("pane", pane.pane_id).project, undefined);
  f.invoke(actions.refresh);
  assert.equal(f.read("pane", "w2:p1").project, "second");
});

test("clear pauses publication even when its snapshot is unavailable", (t) => {
  const f = fixture(t);
  const first = f.repo("first"), second = f.repo("second");
  f.snapshot.panes = [f.pane("w1:p1", "t1", first)];
  f.save(); f.invoke(startup);
  f.setControl({snapshotFailure: true}); f.invoke(actions.clear);
  const afterClear = f.records().length;
  f.snapshot.panes[0].cwd = second; f.save(); f.setControl({});
  f.invoke(events.find((e) => e.name === "tab.renamed").command);
  assert.equal(f.records().length, afterClear, "automatic event stays paused after failed clear snapshot");
  f.invoke(actions.refresh);
  assert.equal(f.read("pane", "w1:p1").project, "second");
});

test("polling follows inactive directories and root failures without full inactive status scans", async (t) => {
  const f = fixture(t, true);
  const first = f.repo("first"), second = f.repo("second");
  const sub = path.join(second, "src"); fs.mkdirSync(sub);
  const plain = path.join(f.dir, "plain"); fs.mkdirSync(plain);
  const realGit = execFileSync("which", ["git"], {encoding: "utf8"}).trim();
  const bin = path.join(f.dir, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "git"), `#!${process.execPath}
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_ROOT + '/git.jsonl', JSON.stringify({cwd: process.cwd(), args}) + '\\n');
const c = JSON.parse(fs.readFileSync(process.env.FAKE_ROOT + '/control.json'));
if (c.rootFailure === process.cwd() && args[0] === 'rev-parse' && args[1] === '--show-toplevel') process.exit(1);
const r = spawnSync(${JSON.stringify(realGit)}, args, {stdio: 'inherit'});
process.exit(r.status ?? 1);
`);
  fs.chmodSync(path.join(bin, "git"), 0o755);
  f.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  f.snapshot.panes = [f.pane("w1:p1", "t1", first), f.pane("w1:p2", "t2", first), f.pane("w2:p1", "t3", first)];
  f.save(); f.invoke(startup);
  const start = fs.readFileSync(path.join(f.dir, "git.jsonl"), "utf8").length;
  for (const [cwd, expected, failure] of [[second, "second"], [sub, "second"], [sub, "src", true], [plain, "plain"], [path.join(f.dir, "gone"), "gone"], [undefined, undefined]]) {
    f.snapshot.panes[1].cwd = cwd;
    f.snapshot.panes[2].cwd = cwd;
    f.setControl(failure ? {rootFailure: fs.realpathSync(sub)} : {});
    f.save();
    await eventually(() => f.read("pane", "w1:p2").project === expected && f.read("pane", "w2:p1").project === expected, `background projects become ${expected}`);
    assert.equal(f.read("pane", "w1:p1").project, "first");
  }
  const probes = fs.readFileSync(path.join(f.dir, "git.jsonl"), "utf8").slice(start).trim().split("\n").filter(Boolean).map(JSON.parse);
  assert.ok(probes.some((p) => p.cwd === fs.realpathSync(second) && p.args[1] === "--show-toplevel"));
  assert.ok(probes.every((p) => p.cwd === fs.realpathSync(first) || JSON.stringify(p.args) === JSON.stringify(["rev-parse", "--show-toplevel"])), "inactive projects use only root probes");
});

test("failed writes and disappearing panes do not stop independent targets or the watcher", async (t) => {
  const f = fixture(t, true);
  const first = f.repo("first"), second = f.repo("second");
  f.snapshot.panes = [f.pane("w1:p1", "t1", first), f.pane("w1:p2", "t2", first), f.pane("w2:p1", "t3", second)];
  f.setControl({fail: ["workspace:w1", "pane:w1:p1"], closeOnReport: "w1:p2"});
  f.save(); f.invoke(startup);
  assert.equal(f.read("pane", "w2:p1").project, "second");
  const initial = f.records().filter((r) => r.kind === "snapshot").length;
  await eventually(() => f.records().filter((r) => r.kind === "snapshot").length >= initial + 4, "partial failures do not retire watcher", 15000);
  f.snapshot.panes[2].cwd = first;
  f.snapshot.panes.splice(1, 1); f.save();
  await eventually(() => f.read("pane", "w2:p1").project === "first", "later target updates after pane closure");
});

test("project leases renew unchanged labels then expire after producer stop", async (t) => {
  const f = fixture(t, true);
  const repo = f.repo("lease");
  f.snapshot.workspaces = [];
  f.snapshot.panes = [f.pane("w1:p1", "t1", repo)];
  const other = {foreign: {value: "keep", source: "other", written: Date.now(), expires: null}};
  fs.writeFileSync(path.join(f.dir, "metadata", encodeURIComponent("pane:w1:p1") + ".json"), JSON.stringify(other));
  f.save(); f.invoke(startup);
  const first = f.raw("pane", "w1:p1").project;
  assert.equal(first.source, "yersonargotev.tab-git");
  assert.ok(first.expires > first.written && first.expires - first.written <= 86400000);
  await eventually(() => f.raw("pane", "w1:p1").project?.expires > first.expires, "unchanged project renews its lease");
  await eventually(() => Date.now() > first.expires, "first lease deadline passes", first.expires - Date.now() + 3000);
  assert.equal(f.read("pane", "w1:p1").project, "lease");
  await f.stop();
  const last = f.raw("pane", "w1:p1").project;
  await eventually(() => f.read("pane", "w1:p1").project === undefined, "stopped producer's project expires", last.expires - Date.now() + 3000);
  assert.equal(f.read("pane", "w1:p1").foreign, "keep");
});

test("upgrades replace legacy watchers and keep projects renewing without focus events", async (t) => {
  const f = fixture(t, true);
  const repo = f.repo("project");
  f.snapshot.workspaces = [];
  f.snapshot.panes = [f.pane("w1:p1", "t1", repo)];
  f.save();
  const stateDir = path.join(f.env.HERDR_PLUGIN_STATE_DIR, createHash("sha256").update(f.env.HERDR_SOCKET_PATH).digest("hex").slice(0, 16));
  const watchLock = path.join(stateDir, "watch.lock");
  const readPid = () => { try { return Number(fs.readFileSync(path.join(watchLock, "pid"), "utf8")); } catch { return 0; } };
  const legacyDir = path.join(f.dir, "legacy installation");
  fs.mkdirSync(legacyDir);
  fs.writeFileSync(path.join(legacyDir, "herdr-plugin.toml"), 'id = "yersonargotev.tab-git"\n');
  // Pre-1.4 watchers had only a PID and never renewed pane metadata. Their exit
  // handler removed the lock unconditionally, so replacement must await exit.
  fs.writeFileSync(path.join(legacyDir, "tab-git.js"), `
const fs = require('node:fs');
const dir = ${JSON.stringify(watchLock)};
fs.mkdirSync(dir, {recursive: true});
fs.writeFileSync(dir + '/pid', String(process.pid));
process.on('exit', () => fs.rmSync(dir, {recursive: true, force: true}));
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`);
  const legacy = spawn(process.execPath, [path.join(legacyDir, "tab-git.js"), "--watch"], {stdio: "ignore"});
  const exited = new Promise((resolve) => legacy.on("exit", resolve));
  t.after(() => { if (legacy.exitCode === null) legacy.kill(); });
  await eventually(() => readPid() === legacy.pid, "legacy watcher owns the session");
  const a = f.launch(startup), b = f.launch(startup);
  await Promise.all([a.result, b.result]);
  const pid = readPid();
  assert.ok(pid && pid !== legacy.pid);
  await exited;
  const first = f.raw("pane", "w1:p1").project;
  await eventually(() => f.raw("pane", "w1:p1").project?.expires > first.expires, "replacement renews project without a focus event");
  f.invoke(startup);
  assert.equal(readPid(), pid, "same installation reuses the watcher");

  // Subsequent upgrades also replace a watcher that already has an identity.
  const nextDir = path.join(f.dir, "next installation");
  fs.mkdirSync(nextDir);
  for (const file of ["run.sh", "tab-git.js", "herdr-plugin.toml"]) fs.copyFileSync(path.join(pluginDir, file), path.join(nextDir, file));
  const result = spawnSync("sh", [path.join(nextDir, "run.sh"), "--all"], {env: f.env, encoding: "utf8", timeout: 20000});
  assert.equal(result.status, 0, result.stderr);
  assert.ok(readPid() && readPid() !== pid, "new installation owns the watcher");
  const next = f.raw("pane", "w1:p1").project;
  await eventually(() => f.raw("pane", "w1:p1").project?.expires > next.expires, "new installation keeps polling");
  const previousPid = readPid();
  fs.appendFileSync(path.join(nextDir, "tab-git.js"), "\n// In-place plugin update.\n");
  const edited = spawnSync("sh", [path.join(nextDir, "run.sh"), "--all"], {env: f.env, encoding: "utf8", timeout: 20000});
  assert.equal(edited.status, 0, edited.stderr);
  assert.ok(readPid() && readPid() !== previousPid, "code changes at the same path replace the watcher");
});

test("overlapping refreshes read fresh state in order and clear beats queued automatic events", async (t) => {
  const f = fixture(t);
  const first = f.repo("first"), second = f.repo("second");
  f.snapshot.workspaces = [];
  f.snapshot.panes = [f.pane("w1:p1", "t1", first)];
  f.save(); f.setControl({hold: "pane:w1:p1"});
  const old = f.launch(startup);
  await eventually(() => fs.existsSync(path.join(f.dir, "held")), "old publication is in flight");
  f.snapshot.panes[0].cwd = second; f.save();
  const newer = f.launch(startup);
  fs.writeFileSync(path.join(f.dir, "release"), "1");
  await Promise.all([old.result, newer.result]);
  assert.equal(f.read("pane", "w1:p1").project, "second");
  f.setControl({hold: "pane:w1:p1"});
  fs.rmSync(path.join(f.dir, "held"), {force: true}); fs.rmSync(path.join(f.dir, "release"));
  const running = f.launch(startup);
  await eventually(() => fs.existsSync(path.join(f.dir, "held")), "publication precedes queued clear");
  const clear = f.launch(actions.clear);
  const automatic = f.launch(events.find((e) => e.name === "tab.renamed").command);
  fs.writeFileSync(path.join(f.dir, "release"), "1");
  await Promise.all([running.result, clear.result, automatic.result]);
  assert.equal(f.read("pane", "w1:p1").project, undefined);
  f.invoke(startup);
  assert.equal(f.read("pane", "w1:p1").project, undefined);
});

test("rapid clear and resume retain polling and sockets isolate pause state", async (t) => {
  const a = fixture(t, true), b = fixture(t, true);
  const sharedState = fs.mkdtempSync(path.join(os.tmpdir(), "project-sessions-"));
  a.env.HERDR_PLUGIN_STATE_DIR = sharedState;
  b.env.HERDR_PLUGIN_STATE_DIR = sharedState;
  t.after(async () => { await a.stop(); await b.stop(); fs.rmSync(sharedState, {recursive: true, force: true}); });
  const first = a.repo("first"), second = a.repo("second");
  for (const f of [a, b]) {
    f.snapshot.workspaces = [];
    f.snapshot.panes = [f.pane("w1:p1", "t1", first)];
    f.save(); f.invoke(startup);
  }
  a.invoke(actions.clear); a.invoke(actions.refresh);
  a.snapshot.panes[0].cwd = second; a.save();
  await eventually(() => a.read("pane", "w1:p1").project === "second", "polling survives rapid clear/resume");
  a.invoke(actions.clear);
  b.snapshot.panes[0].cwd = second; b.save();
  await eventually(() => b.read("pane", "w1:p1").project === "second", "other socket keeps polling");
  assert.equal(a.read("pane", "w1:p1").project, undefined);
  await b.stop();
});
