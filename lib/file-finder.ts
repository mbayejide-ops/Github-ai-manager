import { getRepo, readFile } from "./github";

export type FileMatch = {
  path: string;
  sha: string;
  size?: number;
  type: "blob";
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function scoreMatch(path: string, query: string) {
  const p = normalize(path);
  const q = normalize(query);

  if (p === q) return 1000;

  const fileName = p.split("/").pop() || "";

  if (fileName === q) return 900;

  if (p.endsWith(`/${q}`)) return 850;

  if (fileName.includes(q)) return 700;

  if (p.includes(q)) return 500;

  const parts = q.split("/").filter(Boolean);

  if (
    parts.length > 1 &&
    parts.every((part) => p.includes(part))
  ) {
    return 400;
  }

  return 0;
}

function cleanRepoName(repo: string) {
  return repo
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

export async function findFiles(
  owner: string,
  repo: string,
  query: string
): Promise<FileMatch[]> {
  const repository = await getRepo(owner, repo);

  const branch =
    repository.default_branch || "main";

  const treeResponse = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(
      owner
    )}/${encodeURIComponent(
      repo
    )}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2026-03-10"
      },
      cache: "no-store"
    }
  );

  const tree = await treeResponse.json();

  if (!treeResponse.ok) {
    throw new Error(
      tree?.message ||
        `GitHub tree request failed: ${treeResponse.status}`
    );
  }

  const matches: FileMatch[] = [];

  for (const item of tree.tree || []) {
    if (item.type !== "blob") continue;

    const score = scoreMatch(item.path, query);

    if (score > 0) {
      matches.push({
        path: item.path,
        sha: item.sha,
        size: item.size,
        type: "blob"
      });
    }
  }

  return matches.sort((a, b) => {
    return (
      scoreMatch(b.path, query) -
      scoreMatch(a.path, query)
    );
  });
}

export async function findAndReadFile(
  owner: string,
  repo: string,
  query: string
) {
  const matches = await findFiles(
    owner,
    repo,
    query
  );

  if (matches.length === 0) {
    return {
      found: false,
      matches: []
    };
  }

  if (matches.length > 1) {
    const firstScore = scoreMatch(
      matches[0].path,
      query
    );

    const secondScore = scoreMatch(
      matches[1].path,
      query
    );

    if (firstScore === secondScore) {
      return {
        found: false,
        ambiguous: true,
        matches: matches.slice(0, 10)
      };
    }
  }

  const selected = matches[0];

  const file = await readFile(
    owner,
    repo,
    selected.path
  );

  if (Array.isArray(file)) {
    throw new Error(
      "The selected path is a directory, not a file."
    );
  }

  return {
    found: true,
    path: selected.path,
    sha: selected.sha,
    size: selected.size,
    content: file.decoded_content
  };
    }
