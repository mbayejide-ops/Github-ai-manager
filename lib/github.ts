const API = "https://api.github.com";

function token() {
  const value = process.env.GITHUB_TOKEN?.trim();

  if (!value) {
    throw new Error("GITHUB_TOKEN is not configured in the server environment.");
  }

  return value;
}

async function gh(path: string, init: RequestInit = {}) {
  const githubToken = token();

  const res = await fetch(API + path, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2026-03-10",
      ...(init.headers || {})
    },
    cache: "no-store"
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      typeof data?.message === "string"
        ? data.message
        : "Unknown GitHub API error";

    throw new Error(`GitHub API ${res.status}: ${message}`);
  }

  return data;
}

/**
 * Diagnostic:
 * Checks whether the token currently configured on the server
 * can authenticate with GitHub.
 *
 * IMPORTANT:
 * Never returns the token itself.
 */
export async function getGitHubUser() {
  const user = await gh("/user");

  return {
    login: user.login,
    id: user.id,
    name: user.name,
    public_repos: user.public_repos,
    private_repos: user.total_private_repos
  };
}

export async function listRepos() {
  return gh("/user/repos?per_page=100&sort=updated");
}

export async function getRepo(owner: string, repo: string) {
  return gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  );
}

export async function readFile(
  owner: string,
  repo: string,
  path: string,
  ref?: string
) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";

  const encodedPath = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const data = await gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}${q}`
  );

  if (Array.isArray(data)) {
    return data;
  }

  const content =
    data.encoding === "base64"
      ? Buffer.from(
          data.content.replace(/\n/g, ""),
          "base64"
        ).toString("utf8")
      : data.content;

  return {
    ...data,
    decoded_content: content
  };
}

export async function createOrUpdateFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch?: string
) {
  let sha: string | undefined;

  try {
    const old = await readFile(owner, repo, path, branch);

    if (!Array.isArray(old)) {
      sha = old.sha;
    }
  } catch (e: any) {
    const errorMessage = String(e?.message || "").toLowerCase();

    if (!errorMessage.includes("not found")) {
      throw e;
    }
  }

  const body: {
    message: string;
    content: string;
    sha?: string;
    branch?: string;
  } = {
    message,
    content: Buffer.from(content, "utf8").toString("base64")
  };

  if (sha) {
    body.sha = sha;
  }

  if (branch) {
    body.branch = branch;
  }

  const encodedPath = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
}

export async function deleteFile(
  owner: string,
  repo: string,
  path: string,
  message: string,
  branch?: string
) {
  const old = await readFile(owner, repo, path, branch);

  if (Array.isArray(old) || !old.sha) {
    throw new Error("File SHA could not be determined.");
  }

  const body: {
    message: string;
    sha: string;
    branch?: string;
  } = {
    message,
    sha: old.sha
  };

  if (branch) {
    body.branch = branch;
  }

  const encodedPath = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
}

export async function createRepo(
  name: string,
  description = "",
  isPrivate = true
) {
  return gh("/user/repos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      description,
      private: isPrivate
    })
  });
}

export async function createBranch(
  owner: string,
  repo: string,
  branch: string,
  from: string
) {
  const base = await gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(from)}`
  );

  return gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: base.object.sha
      })
    }
  );
}

export async function createPullRequest(
  owner: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body = ""
) {
  return gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title,
        head,
        base,
        body
      })
    }
  );
}

export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number
) {
  return gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/merge`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        merge_method: "squash"
      })
    }
  );
}

export async function deleteRepo(
  owner: string,
  repo: string
) {
  return gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      method: "DELETE"
    }
  );
    }
