// Ship: commit the remake, keep it in a private GitHub repo, and check it serves from a local server.
// This fork has no hosting step. A remake stays on your machine (`remake serve`) until you move it
// into a site of your own.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { copyTemplates } from "./project.mjs";
import { startServer } from "./serve.mjs";
import { RemakeError, say, ok, warn, step, readJson, writeJson } from "./util.mjs";

export const LOCAL_PORT = 4310;

export function sh(cmd, args, { cwd, input, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.error) {
    if (allowFail) return { ok: false, out: r.error.message, code: -1 };
    throw new RemakeError(`${cmd} isn't installed.`, "Run `remake doctor --fix`.");
  }
  if (r.status !== 0 && !allowFail) throw new RemakeError(`${cmd} ${args.join(" ")} failed:\n${out.trim().slice(-1500)}`);
  return { ok: r.status === 0, out, stdout: r.stdout || "", code: r.status };
}

// Serve site/ on a throwaway port and fetch the first page: proves the folder runs on its own.
export async function verifyLocal(siteDir, pagePath = "/") {
  const res = { gate: "local", page: false };
  let server = null;
  try {
    server = await startServer(siteDir, { port: 0 });
    const r = await fetch(new URL(pagePath, server.url), { redirect: "manual" });
    const html = await r.text();
    res.page = r.status === 200 && html.length > 0;
    res.status = r.status;
  } catch (e) {
    res.error = e.message;
  } finally {
    if (server) await server.close();
  }
  return res;
}

function ensureAuthor(root) {
  if (sh("git", ["config", "user.email"], { cwd: root, allowFail: true }).stdout.trim()) return;
  const me = JSON.parse(sh("gh", ["api", "user"], { allowFail: true }).stdout || "{}");
  const email = me.email || (me.id && me.login ? `${me.id}+${me.login}@users.noreply.github.com` : "remake@users.noreply.github.com");
  sh("git", ["config", "user.email", email], { cwd: root });
  sh("git", ["config", "user.name", me.name || me.login || "Remake"], { cwd: root });
}

function commitAll(root, message) {
  sh("git", ["add", "-A"], { cwd: root });
  const dirty = !sh("git", ["diff", "--cached", "--quiet"], { cwd: root, allowFail: true }).ok;
  if (dirty) sh("git", ["commit", "-m", message, "-m", "Made with https://github.com/stevegustafson32/remake (fork of rubenhassid1/remake)"], { cwd: root });
  return dirty;
}

// Create or push the private GitHub repo. Returns { repoUrl, visibility } or null when --no-remote.
function pushPrivate(root, name) {
  if (!sh("gh", ["auth", "status"], { allowFail: true }).ok) {
    throw new RemakeError("GitHub CLI isn't signed in.", "Run `gh auth login --web` and click through once in your browser, or ship with --no-remote.");
  }
  const hasOrigin = sh("git", ["remote", "get-url", "origin"], { cwd: root, allowFail: true }).ok;
  if (!hasOrigin) sh("gh", ["repo", "create", name, "--private", "--source", ".", "--remote", "origin", "--push"], { cwd: root });
  else sh("git", ["push", "-u", "origin", "HEAD"], { cwd: root });
  const view = sh("gh", ["repo", "view", "--json", "url,visibility", "-q", ".url + \" \" + .visibility"], { cwd: root }).stdout.trim();
  const [repoUrl, visibility] = view.split(" ");
  if (visibility && visibility !== "PRIVATE") warn(`The repo is ${visibility.toLowerCase()}. A remake should stay private until it's yours.`);
  const result = { repoUrl, visibility: visibility || "PRIVATE" };
  return result;
}

export async function ship(project, opts = {}) {
  const { cfg, p, root } = project;
  const score = readJson(p.score);
  if (!score) warn("No score yet: shipping anyway, but the report won't pass until `remake score` passes.");
  else if (!score.pass) warn("The score doesn't pass yet. Shipping anyway so you can look at it; the report will say what's left.");
  copyTemplates(root, { name: cfg.name, url: cfg.url });
  // A remade page that isn't the home page (/en, /about/): send the site's root to it.
  const first = cfg.pages?.[0] || "/";
  if (first !== "/" && !fs.existsSync(path.join(p.site, "index.html"))) {
    fs.writeFileSync(path.join(p.site, "index.html"), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><meta http-equiv="refresh" content="0;url=${first}"><link rel="canonical" href="${first}"><title>Redirecting</title><a href="${first}">Continue</a>`);
  }
  const prev = readJson(p.ship, {}) || {};
  const name = opts.name || prev.name || `remake-${cfg.name}`.slice(0, 90);
  const remote = !opts.noRemote;

  step("Committing the remake");
  if (!fs.existsSync(path.join(root, ".git"))) sh("git", ["init", "-b", "main"], { cwd: root });
  ensureAuthor(root);
  const committed = commitAll(root, `Remake of ${cfg.url}`);
  ok(committed ? "committed" : "nothing new to commit");

  let repo = { repoUrl: prev.repo || null, visibility: prev.visibility || "LOCAL" };
  if (remote) {
    step("Saving to a private GitHub repo");
    repo = pushPrivate(root, name);
    ok(repo.repoUrl);
  } else {
    step("Skipping GitHub (--no-remote): the remake stays on this machine only");
  }

  step("Checking the remake serves on its own");
  const check = await verifyLocal(p.site, first);
  const verified = check.page ? "local" : "no";
  if (check.page) ok(`served ${first} from a local server (status ${check.status})`);
  else warn(`local check: ${JSON.stringify(check)}`);

  const head = sh("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  const url = `http://127.0.0.1:${LOCAL_PORT}`;
  const shipInfo = { name, target: "local", repo: repo.repoUrl, visibility: repo.visibility, url, verified, check, commit: head, at: new Date().toISOString() };
  writeJson(p.ship, shipInfo);
  say(`\n  Local:    ${url}  (start it with: remake serve)\n  Repo:     ${repo.repoUrl || "none (--no-remote)"} (${repo.visibility.toLowerCase()})\n  Proof:    ${url}/_remake/\n  Swap:     ${url}/_remake/swap/`);
  say("\nNext: remake report");
  return shipInfo;
}
