"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const plugin = require("../tab-git.js");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tab-git-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(dir, "base"), "one\n");
  git("add", "."); git("commit", "-qm", "base");
  return { dir, git, put(name, value) { fs.writeFileSync(path.join(dir, name), value); } };
}

test("each category and combined status count paths once", (t) => {
  const f = fixture(t);
  f.put("added", "a"); f.git("add", "added");
  f.put("base", "two\n");
  f.put("untracked\nname", "u");
  let info = plugin.gitInfo(f.dir, 1500);
  assert.equal(info.kind, "ok");
  assert.deepEqual([info.added, info.modified, info.untracked, info.deleted, info.conflicted], [1, 1, 1, 0, 0]);
  assert.equal(plugin.tokens(info).gitclean, undefined);
  f.git("add", "base");
  f.put("base", "three\n");
  info = plugin.gitInfo(f.dir, 1500);
  assert.equal(info.modified, 1); // MM is one path.
  f.git("commit", "-qam", "tracked");
  fs.rmSync(path.join(f.dir, "base"));
  assert.equal(plugin.gitInfo(f.dir, 1500).deleted, 1);
});

test("rename, staged add with unstaged edit, and clean", (t) => {
  const f = fixture(t);
  assert.equal(plugin.tokens(plugin.gitInfo(f.dir, 1500)).gitclean, "clean");
  f.git("mv", "base", "renamed");
  assert.equal(plugin.gitInfo(f.dir, 1500).modified, 1);
  f.put("new", "one"); f.git("add", "new"); f.put("new", "two");
  const info = plugin.gitInfo(f.dir, 1500);
  assert.equal(info.added, 1);
  assert.equal(info.modified, 1);
});

test("added, modified, deleted and untracked work individually", (t) => {
  for (const kind of ["added", "modified", "deleted", "untracked"]) {
    const f = fixture(t);
    if (kind === "added") { f.put("new", "x"); f.git("add", "new"); }
    if (kind === "modified") f.put("base", "changed");
    if (kind === "deleted") fs.rmSync(path.join(f.dir, "base"));
    if (kind === "untracked") f.put("new", "x");
    const info = plugin.gitInfo(f.dir, 1500);
    assert.equal(info.kind, "ok");
    for (const name of ["added", "modified", "deleted", "untracked", "conflicted"]) {
      assert.equal(info[name], name === kind ? 1 : 0, `${kind} => ${name}`);
    }
  }
});

test("conflict, divergence, detached HEAD and missing upstream", (t) => {
  const f = fixture(t);
  const main = f.git("branch", "--show-current");
  f.git("branch", "upstream");
  f.git("branch", "--set-upstream-to=upstream", main);
  f.put("base", "local\n"); f.git("commit", "-qam", "local");
  assert.equal(plugin.gitInfo(f.dir, 1500).ahead, 1);
  f.git("checkout", "-q", "upstream");
  f.put("base", "remote\n"); f.git("commit", "-qam", "remote");
  f.git("checkout", "-q", main);
  const divergent = plugin.gitInfo(f.dir, 1500);
  assert.deepEqual([divergent.ahead, divergent.behind], [1, 1]);
  const merge = spawnSync("git", ["merge", "upstream"], { cwd: f.dir });
  assert.notEqual(merge.status, 0);
  assert.equal(plugin.gitInfo(f.dir, 1500).conflicted, 1);
  f.git("merge", "--abort");
  f.git("checkout", "-q", "--detach", "HEAD");
  assert.match(plugin.gitInfo(f.dir, 1500).branch, /^detached@[0-9a-f]+$/);
  assert.equal(plugin.gitInfo(f.dir, 1500).ahead, 0);
});

test("metadata follows active tab, inactive Space pane and cwd; clears stale values", async (t) => {
  const first = fixture(t), second = fixture(t);
  second.put("new", "x");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fake-herdr-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = path.join(root, "state.json");
  const cli = path.join(root, "herdr");
  fs.writeFileSync(cli, `#!/usr/bin/env node
const fs=require('fs');const p=process.env.FAKE_STATE;const s=JSON.parse(fs.readFileSync(p));const a=process.argv.slice(2);
if(a[0]==='api'){console.log(JSON.stringify({result:{snapshot:s.snapshot}}));process.exit(0)}
const id=a[2];const store=a[0]==='pane'?(s.paneTokens ||= {}):s.tokens;store[id] ||= {};for(let i=5;i<a.length;i+=2){if(a[i]==='--token'){const at=a[i+1].indexOf('=');store[id][a[i+1].slice(0,at)]=a[i+1].slice(at+1)}else if(a[i]==='--clear-token')delete store[id][a[i+1]]}
fs.writeFileSync(p,JSON.stringify(s));
`);
  fs.chmodSync(cli, 0o755);
  const snapshot = { focused_workspace_id: "w1", workspaces: [{ workspace_id: "w1", active_tab_id: "t2" }, { workspace_id: "w2", active_tab_id: "t3" }], tabs: [
    { tab_id: "t1", label: "first" }, { tab_id: "t2", label: "codex · dots" }, { tab_id: "t3", label: "nvim · project" },
  ], panes: [
    { pane_id: "w1:p1", tab_id: "t1", focused: true, foreground_cwd: first.dir },
    { pane_id: "w1:p2", tab_id: "t2", focused: true, foreground_cwd: second.dir },
    { pane_id: "w2:p1", tab_id: "t3", focused: false, foreground_cwd: first.dir },
    { pane_id: "w2:p2", tab_id: "t3", focused: true, foreground_cwd: second.dir },
  ] };
  const save = (tokens = {}) => fs.writeFileSync(state, JSON.stringify({ snapshot, tokens }));
  const read = () => JSON.parse(fs.readFileSync(state)).tokens;
  const env = { ...process.env, HERDR_BIN_PATH: cli, HERDR_CONFIG_DIR: root, HERDR_PLUGIN_STATE_DIR: path.join(root, "plugin-state"), FAKE_STATE: state };
  const call = (...args) => spawnSync("sh", [path.join(__dirname, "..", "run.sh"), ...args], { env, encoding: "utf8" });
  const eventArgs = (event) => {
    const manifest = fs.readFileSync(path.join(__dirname, "..", "herdr-plugin.toml"), "utf8");
    const match = manifest.match(new RegExp(`\\[\\[events\\]\\]\\s*on = "${event}"\\s*command = (\\[[^\\n]+\\])`));
    assert.ok(match, `missing ${event} hook`);
    const command = JSON.parse(match[1]);
    assert.deepEqual(command.slice(0, 2), ["sh", "run.sh"]);
    return command.slice(2);
  };
  save();
  assert.equal(call("--all", "--clear").status, 0);
  assert.equal(call("--all").status, 0);
  assert.equal(read().w1.gituntracked, "?1");
  assert.equal(read().w2.gituntracked, "?1");
  assert.equal(read().w1.tab_name, "codex · dots");
  assert.equal(read().w2.tab_name, "nvim · project");
  snapshot.tabs[2].label = "renamed";
  save(read());
  for (const event of ["tab.created", "tab.renamed", "tab.closed", "tab.moved"]) {
    assert.deepEqual(eventArgs(event), ["--all"]);
  }
  assert.equal(call(...eventArgs("tab.renamed")).status, 0);
  assert.equal(read().w2.tab_name, "renamed");
  snapshot.panes[3].foreground_cwd = first.dir;
  save(read());
  assert.equal(call("--all").status, 0);
  assert.equal(read().w2.gitclean, "clean");
  assert.equal(read().w2.gituntracked, undefined);
  snapshot.panes[3].foreground_cwd = root;
  const stale = read();
  Object.assign(stale.w2, {gitstaged: "+9", gitworkmodified: "!9", gitforward: "⇡9", gitbackward: "⇣9", gitdiverged: "⇕⇡9⇣9"});
  save(stale);
  assert.equal(call("--all").status, 0);
  assert.deepEqual(read().w2, { tab_name: "renamed" });
  assert.equal(read().w1.gituntracked, "?1");
  snapshot.panes[3].foreground_cwd = first.dir;
  save(read());
  second.put("another", "y");
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline && read().w1.gituntracked !== "?2") {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(read().w1.gituntracked, "?2", "watcher refreshes after a file change");
  assert.equal(call("--clear").status, 0);
  assert.deepEqual(read().w1, {});
});

test("simultaneous refreshes serialize metadata writes", async (t) => {
  const f = fixture(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fake-herdr-overlap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = path.join(root, "state.json"), log = path.join(root, "writes.log"), cli = path.join(root, "herdr");
  fs.writeFileSync(state, JSON.stringify({ result: { snapshot: { focused_workspace_id: "w", workspaces: [{ workspace_id: "w", active_tab_id: "t" }], panes: [{ pane_id: "w:p", tab_id: "t", focused: true, foreground_cwd: f.dir }] } } }));
  fs.writeFileSync(cli, `#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);
if(a[0]==='api'){fs.appendFileSync(process.env.FAKE_LOG,'B');process.stdout.write(fs.readFileSync(process.env.FAKE_STATE));process.exit(0)}
fs.appendFileSync(process.env.FAKE_LOG,'S');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
fs.appendFileSync(process.env.FAKE_LOG,'E');
`);
  fs.chmodSync(cli, 0o755);
  const env = { ...process.env, HERDR_BIN_PATH: cli, HERDR_CONFIG_DIR: root, HERDR_PLUGIN_STATE_DIR: path.join(root, "plugin-state"), FAKE_STATE: state, FAKE_LOG: log };
  const invoke = () => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "..", "tab-git.js"), "--all"], { env, stdio: "ignore" });
    child.on("exit", resolve);
  });
  const results = await Promise.all([invoke(), invoke()]);
  assert.deepEqual(results, [0, 0]);
  assert.equal(fs.readFileSync(log, "utf8"), "BSESEBSESE");
  spawnSync(process.execPath, [path.join(__dirname, "..", "tab-git.js"), "--clear"], { env });
});

test("failed and timed out status cannot become clean", (t) => {
  const f = fixture(t);
  const original = process.env.PATH;
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "git-fail-"));
  t.after(() => { process.env.PATH = original; fs.rmSync(bin, { recursive: true, force: true }); });
  const real = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const wrapper = path.join(bin, "git");
  fs.writeFileSync(wrapper, `#!/bin/sh\nif [ "$1" = status ]; then exit 1; fi\nexec "${real}" "$@"\n`);
  fs.chmodSync(wrapper, 0o755);
  process.env.PATH = `${bin}:${original}`;
  assert.equal(plugin.gitInfo(f.dir, 1500).kind, "failure");
  fs.writeFileSync(wrapper, `#!/bin/sh\nif [ "$1" = status ]; then sleep 2; fi\nexec "${real}" "$@"\n`);
  assert.equal(plugin.gitInfo(f.dir, 100).kind, "failure");
});


test("prompt tokens match staged/worktree vocabulary and exclusive upstream states", (t) => {
  const f = fixture(t);
  const branch = f.git("branch", "--show-current");
  f.put("base", "staged\n"); f.git("add", "base"); f.put("base", "unstaged\n");
  f.put("new", "untracked");
  let values = plugin.tokens(plugin.gitInfo(f.dir, 1500));
  assert.equal(values.gitbranch, branch);
  assert.equal(values.gitstaged, "+1");
  assert.equal(values.gitworkmodified, "!1");
  assert.equal(values.gituntracked, "?1");
  for (const [ahead, behind, expected] of [[2, 0, {gitforward: "⇡2"}], [0, 3, {gitbackward: "⇣3"}], [2, 3, {gitdiverged: "⇕⇡2⇣3"}], [0, 0, {}]]) {
    values = plugin.tokens({...plugin.gitInfo(f.dir, 1500), ahead, behind});
    assert.deepEqual(Object.fromEntries(Object.entries(values).filter(([key]) => ["gitforward", "gitbackward", "gitdiverged"].includes(key))), expected);
  }
});


test("prompt counts distinguish index, worktree, rename, deletion and conflict", () => {
  const status = Buffer.from("M  staged\0 M unstaged\0MM both\0AM added-and-edited\0D  deleted\0R  renamed\0old-name\0UU conflict\0?? untracked\0 A intent-to-add\0T  typechange\0");
  const info = plugin.parseStatus(status);
  assert.equal(info.staged, 4);
  assert.equal(info.workmodified, 4);
  assert.equal(info.conflicted, 1);
  assert.equal(info.untracked, 1);
});

// Run with STARSHIP_CONFIG pointing to the dots-managed prompt for differential QA.
test("prompt tokens match rendered Starship on real Git states", {skip: !process.env.STARSHIP_CONFIG}, (t) => {
  const f = fixture(t);
  const verify = () => {
    const info = plugin.gitInfo(f.dir, 1500);
    const values = plugin.tokens(info);
    const actual = ["gitstaged", "gitworkmodified", "gituntracked", "gitforward", "gitbackward", "gitdiverged"].map(key => values[key]).filter(Boolean).join(" ");
    const rendered = execFileSync("starship", ["module", "git_status", "--path", f.dir], {encoding: "utf8"}).replace(/\x1b\[[0-9;]*m/g, "").trim();
    assert.equal(actual, rendered, JSON.stringify(info));
    const branch = execFileSync("starship", ["module", "git_branch", "--path", f.dir], {encoding: "utf8"}).replace(/\x1b\[[0-9;]*m/g, "").trim();
    assert.equal(values.gitbranch, branch.replace(/^ /, ""));
  };
  verify();
  f.put("base", "modified\n"); verify();
  f.git("add", "base"); verify();
  f.put("base", "both\n"); verify();
  f.put("new", "added\n"); verify();
  f.git("add", "new"); verify();
  f.put("new", "edited\n"); verify();
  f.git("commit", "-qam", "changes"); verify();
  f.git("mv", "base", "renamed"); verify();
  f.git("commit", "-qm", "rename");
  fs.rmSync(path.join(f.dir, "renamed")); verify();
  f.git("add", "renamed"); verify();
  f.git("commit", "-qm", "deletion");
  f.git("branch", "upstream");
  const branch = f.git("branch", "--show-current");
  f.git("branch", "--set-upstream-to=upstream", branch);
  f.put("new", "local\n"); f.git("commit", "-qam", "local"); verify();
  f.git("checkout", "-q", "upstream");
  f.put("new", "remote\n"); f.git("commit", "-qam", "remote");
  f.git("checkout", "-q", branch); verify();
  assert.notEqual(spawnSync("git", ["merge", "upstream"], {cwd: f.dir}).status, 0); verify();
  f.git("merge", "--abort");
  f.git("reset", "--hard", "upstream~1"); verify();
});
