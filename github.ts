const API = "https://api.github.com";

function token() {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured.");
  return process.env.GITHUB_TOKEN;
}

async function gh(path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {})
    },
    cache: "no-store"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `GitHub API error ${res.status}`);
  return data;
}

export async function listRepos() {
  return gh("/user/repos?per_page=100&sort=updated");
}

export async function getRepo(owner: string, repo: string) {
  return gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}

export async function readFile(owner: string, repo: string, path: string, ref?: string) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}${q}`);
  if (Array.isArray(data)) return data;
  const content = data.encoding === "base64" ? Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8") : data.content;
  return { ...data, decoded_content: content };
}

export async function createOrUpdateFile(owner: string, repo: string, path: string, content: string, message: string, branch?: string) {
  let sha: string | undefined;
  try {
    const old = await readFile(owner, repo, path, branch);
    if (!Array.isArray(old)) sha = old.sha;
  } catch (e: any) {
    if (!String(e.message).toLowerCase().includes("not found")) throw e;
  }
  const body: any = { message, content: Buffer.from(content, "utf8").toString("base64") };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;
  return gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
}

export async function deleteFile(owner: string, repo: string, path: string, message: string, branch?: string) {
  const old = await readFile(owner, repo, path, branch);
  if (Array.isArray(old) || !old.sha) throw new Error("File SHA could not be determined.");
  const body: any = { message, sha: old.sha };
  if (branch) body.branch = branch;
  return gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
}

export async function createRepo(name: string, description = "", isPrivate = true) {
  return gh("/user/repos", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, private: isPrivate })
  });
}

export async function createBranch(owner: string, repo: string, branch: string, from: string) {
  const base = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(from)}`);
  return gh(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha })
  });
}

export async function createPullRequest(owner: string, repo: string, title: string, head: string, base: string, body = "") {
  return gh(`/repos/${owner}/${repo}/pulls`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, head, base, body })
  });
}

export async function mergePullRequest(owner: string, repo: string, number: number) {
  return gh(`/repos/${owner}/${repo}/pulls/${number}/merge`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merge_method: "squash" })
  });
}

export async function deleteRepo(owner: string, repo: string) {
  return gh(`/repos/${owner}/${repo}`, { method: "DELETE" });
}
