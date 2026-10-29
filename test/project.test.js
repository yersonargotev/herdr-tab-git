"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");

const pluginDir = path.join(__dirname, "..");
const spaceNames = ["tab_name", "gitbranch", "gitadded", "gitmodified", "gitdeleted", "gituntracked", "gitconflicted", "gitahead", "gitbehind", "gitclean", "gitstaged", "gitworkmodified", "gitforward", "gitbackward", "gitdiverged"];

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pane-project-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = path.join(dir, "snapshot.json");
  const bin = path.join(dir, "herdr");
  const config = path.join(dir, "config");
  const pluginState = path.join(dir, "plugin-state");
  fs.mkdirSync(config);
  fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({timeoutMs: 500, pollMs: 60000}));
  const socket = path.join(dir, "test.sock");
  const watchLock = path.join(pluginState, createHash("sha256").update(socket).digest("hex").slice(0, 16), "watch.lock");
  fs.mkdirSync(watchLock, {recursive: true});
  fs.writeFileSync(path.join(watchLock, "pid"), String(process.pid));
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const file = process.env.FAKE_STATE;
const state = JSON.parse(fs.readFileSync(file));
if (JSON.stringify(args) === JSON.stringify(['api', 'snapshot'])) {
  console.log(JSON.stringify({result: {snapshot: state.snapshot}}));
  process.exit(0);
}
const [scope, command, id, source, producer] = args;
assert.ok(['workspace', 'pane'].includes(scope));
assert.equal(command, 'report-metadata');
assert.equal(source, '--source');
assert.equal(producer, 'yersonargotev.tab-git');
assert.ok((scope === 'pane' ? state.snapshot.panes : state.snapshot.workspaces).some(item => item[scope + '_id'] === id));
assert.equal(args.length % 2, 1);
const allowed = scope === 'pane' ? ['project'] : ${JSON.stringify(spaceNames)};
const seen = new Set();
state.tokens[scope][id] ||= {};
for (let i = 5; i < args.length; i += 2) {
  const [flag, value] = args.slice(i, i + 2);
  if (flag === '--ttl-ms') {
    assert.equal(scope, 'pane');
    assert.ok(Number(value) > 0 && Number(value) <= 86400000);
    continue;
  }
  assert.ok(['--token', '--clear-token'].includes(flag));
  const at = value.indexOf('=');
  const name = flag === '--token' ? value.slice(0, at) : value;
  assert.ok(flag !== '--token' || at > 0);
  assert.ok(allowed.includes(name), name);
  assert.ok(!seen.has(name), name);
  seen.add(name);
  if (flag === '--token') state.tokens[scope][id][name] = value.slice(at + 1);
  else delete state.tokens[scope][id][name];
}
assert.deepEqual([...seen].sort(), [...allowed].sort());
fs.writeFileSync(file, JSON.stringify(state));
`);
  fs.chmodSync(bin, 0o755);
  const env = {...process.env, HERDR_BIN_PATH: bin, HERDR_CONFIG_DIR: dir, HERDR_PLUGIN_CONFIG_DIR: config, HERDR_PLUGIN_STATE_DIR: pluginState, HERDR_SOCKET_PATH: socket, FAKE_STATE: state};
  const snapshot = {focused_workspace_id: "w1", workspaces: [{workspace_id: "w1", label: "dots", active_tab_id: "w1:t1"}, {workspace_id: "w2", label: "other", active_tab_id: "w2:t1"}], tabs: [{tab_id: "w1:t1", label: "active"}, {tab_id: "w1:t2", label: "inactive"}, {tab_id: "w2:t1", label: "elsewhere"}], panes: []};
  const save = (tokens = {workspace: {}, pane: {}}) => fs.writeFileSync(state, JSON.stringify({snapshot, tokens}));
  const read = () => JSON.parse(fs.readFileSync(state));
  const invoke = (command) => {
    const result = spawnSync(command[0], [path.join(pluginDir, command[1]), ...command.slice(2)], {env, encoding: "utf8", timeout: 20000});
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return read();
  };
  const manifest = fs.readFileSync(path.join(pluginDir, "herdr-plugin.toml"), "utf8");
  const startup = JSON.parse(manifest.match(/\[\[startup\]\]\s*command = (\[[^\n]+\])/)[1]);
  const action = (name) => JSON.parse(manifest.match(new RegExp(`\\[\\[actions\\]\\]\\s*id = "${name}"[^]*?command = (\\[[^\\n]+\\])`))[1]);
  const git = (cwd, ...args) => execFileSync("git", args, {cwd, encoding: "utf8"}).trim();
  const repo = (name) => {
    const cwd = path.join(dir, name);
    fs.mkdirSync(cwd, {recursive: true});
    git(cwd, "init", "-q");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "Test");
    fs.writeFileSync(path.join(cwd, "base"), "base\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "base");
    return cwd;
  };
  const pane = (id, tab, cwd, foreground) => ({pane_id: id, workspace_id: id.split(":")[0], tab_id: tab, cwd, foreground_cwd: foreground, agent: "codex"});
  save();
  return {dir, env, snapshot, save, read, invoke, startup, action, git, repo, pane};
}

test("startup and refresh publish independent pane projects across all tabs and Workspaces", (t) => {
  const f = fixture(t);
  const dots = f.repo("dots"), herdr = f.repo("herdr-tab-git");
  const subdir = path.join(herdr, "src");
  fs.mkdirSync(subdir);
  const worktree = path.join(f.dir, "linked worktree ");
  f.git(herdr, "worktree", "add", "-qb", "linked", worktree);
  const duplicateA = f.repo("one/api"), duplicateB = f.repo("two/api");
  const plain = path.join(f.dir, "plain folder ");
  fs.mkdirSync(plain);
  f.snapshot.panes = [
    f.pane("w1:p1", "w1:t1", dots),
    f.pane("w1:p2", "w1:t1", dots, subdir),
    f.pane("w1:p3", "w1:t2", worktree),
    f.pane("w2:p1", "w2:t1", duplicateA),
    f.pane("w2:p2", "w2:t1", duplicateB),
    f.pane("w2:p3", "w2:t1", plain),
    f.pane("w2:p4", "w2:t1"),
  ];
  f.save({workspace: {}, pane: {"w2:p4": {project: "old", unrelated: "keep"}}});
  let state = f.invoke(f.startup);
  assert.deepEqual(Object.fromEntries(Object.entries(state.tokens.pane).map(([id, values]) => [id, values.project])), {
    "w1:p1": "dots", "w1:p2": "herdr-tab-git", "w1:p3": "linked worktree ", "w2:p1": "api", "w2:p2": "api", "w2:p3": "plain folder ", "w2:p4": undefined,
  });
  assert.equal(state.tokens.pane["w2:p4"].unrelated, "keep");
  assert.equal(state.tokens.workspace.w1.project, undefined);
  assert.equal(state.tokens.workspace.w1.tab_name, "active");
  f.snapshot.panes[1].foreground_cwd = dots;
  f.snapshot.panes[4].cwd = undefined;
  f.save(state.tokens);
  state = f.invoke(f.action("refresh"));
  assert.equal(state.tokens.pane["w1:p2"].project, "dots");
  assert.equal(state.tokens.pane["w2:p2"].project, undefined);
  f.save(state.tokens);
  state = f.invoke(f.action("clear"));
  assert.deepEqual(state.tokens.workspace, {w1: {}, w2: {}});
  for (const values of Object.values(state.tokens.pane)) assert.equal(values.project, undefined);
  assert.equal(state.tokens.pane["w2:p4"].unrelated, "keep");
});

test("project root failures fall back while status and upstream failures preserve root identity", (t) => {
  const f = fixture(t);
  const repo = f.repo("checkout");
  const subdir = path.join(repo, "reported directory ");
  fs.mkdirSync(subdir);
  f.snapshot.workspaces = f.snapshot.workspaces.slice(0, 1);
  f.snapshot.panes = [f.pane("w1:p1", "w1:t1", subdir)];
  const realGit = execFileSync("which", ["git"], {encoding: "utf8"}).trim();
  const bin = path.join(f.dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "git"), `#!${process.execPath}
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
const mode = process.env.GIT_FAILURE;
const root = args[0] === 'rev-parse' && args[1] === '--show-toplevel';
if (root && mode === 'root-timeout') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
if ((root && mode === 'root-failure') || (args[0] === 'status' && mode === 'status') || (args[1] === '--verify' && mode === 'upstream')) {
  process.stderr.write('injected failure');
  process.exit(1);
}
const result = spawnSync(${JSON.stringify(realGit)}, args, {stdio: 'inherit'});
process.exit(result.status ?? 1);
`);
  fs.chmodSync(path.join(bin, "git"), 0o755);
  f.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  for (const [mode, expected] of [["root-failure", "reported directory "], ["root-timeout", "reported directory "], ["status", "checkout"], ["upstream", "checkout"]]) {
    f.env.GIT_FAILURE = mode;
    f.save({workspace: {w1: Object.fromEntries(spaceNames.map(name => [name, "stale"]))}, pane: {"w1:p1": {project: "stale"}}});
    const state = f.invoke(f.action("refresh"));
    assert.equal(state.tokens.pane["w1:p1"].project, expected, mode);
    assert.deepEqual(state.tokens.workspace.w1, {tab_name: "active"}, mode);
  }
});

test("pane publication preserves newer Space tokens and their exclusive divergence states", (t) => {
  const f = fixture(t);
  const repo = f.repo("project");
  const git = (...args) => f.git(repo, ...args);
  const branch = git("branch", "--show-current");
  git("branch", "upstream");
  git("branch", "--set-upstream-to=upstream", branch);
  fs.writeFileSync(path.join(repo, "base"), "local\n");
  git("commit", "-qam", "local");
  f.snapshot.workspaces = f.snapshot.workspaces.slice(0, 1);
  f.snapshot.panes = [f.pane("w1:p1", "w1:t1", repo)];
  const verify = (expected) => {
    f.save(f.read().tokens);
    const state = f.invoke(f.action("refresh"));
    assert.equal(state.tokens.pane["w1:p1"].project, "project");
    const actual = state.tokens.workspace.w1;
    for (const name of ["gitforward", "gitbackward", "gitdiverged"]) assert.equal(actual[name], expected[name], name);
    return actual;
  };
  let values = verify({gitforward: "⇡1"});
  assert.equal(values.gitahead, "↑1");
  git("checkout", "-q", "upstream");
  fs.writeFileSync(path.join(repo, "remote"), "remote\n");
  git("add", "remote"); git("commit", "-qm", "remote");
  git("checkout", "-q", branch);
  values = verify({gitdiverged: "⇕⇡1⇣1"});
  assert.equal(values.gitbehind, "↓1");
  git("reset", "--hard", "upstream~1");
  verify({gitbackward: "⇣1"});
  fs.writeFileSync(path.join(repo, "base"), "staged\n");
  git("add", "base");
  fs.writeFileSync(path.join(repo, "base"), "unstaged\n");
  values = verify({gitbackward: "⇣1"});
  assert.equal(values.gitstaged, "+1");
  assert.equal(values.gitworkmodified, "!1");
  git("reset", "--hard", "upstream");
  values = verify({});
  assert.equal(values.gitstaged, undefined);
  assert.equal(values.gitworkmodified, undefined);
  assert.equal(values.gitclean, "clean");
});
