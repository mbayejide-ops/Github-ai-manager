import {
  createBranch,
  createOrUpdateFile,
  createPullRequest,
  createRepo,
  deleteFile,
  deleteRepo,
  getGitHubUser,
  getRepo,
  listRepos,
  readFile
} from "./github";

import {
  findAndReadFile
} from "./file-finder";

import { groqChat } from "./groq";

const GITHUB_API =
  "https://api.github.com";

/*
 * =========================================================
 * TYPES
 * =========================================================
 */

type ChatInputMessage = {
  role: "user" | "assistant";
  content?: string | null;
};

type AgentMessage = {
  role:
    | "system"
    | "user"
    | "assistant"
    | "tool";
  content?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

/*
 * =========================================================
 * GITHUB HELPERS
 * =========================================================
 */

function githubToken() {
  const token =
    process.env.GITHUB_TOKEN?.trim();

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not configured."
    );
  }

  return token;
}

async function githubRequest(
  path: string,
  init: RequestInit = {}
) {
  const response =
    await fetch(
      `${GITHUB_API}${path}`,
      {
        ...init,
        headers: {
          Accept:
            "application/vnd.github+json",
          Authorization:
            `Bearer ${githubToken()}`,
          "X-GitHub-Api-Version":
            "2022-11-28",
          ...(init.headers || {})
        },
        cache: "no-store"
      }
    );

  const data =
    await response.json().catch(
      () => ({})
    );

  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status}: ${
        data?.message ||
        "Unknown GitHub API error"
      }`
    );
  }

  return data;
}

async function getOwner() {
  const user =
    await getGitHubUser();

  if (!user?.login) {
    throw new Error(
      "Unable to detect the connected GitHub account."
    );
  }

  return user.login;
}

/*
 * =========================================================
 * TEXT HELPERS
 * =========================================================
 */

function normalize(
  text: string
) {
  return text
    .toLowerCase()
    .replace(
      /[“”"'`]/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

/*
 * Remove fenced code blocks before simple
 * natural-language command parsing.
 *
 * This is important because users may send:
 *
 * ```ts
 * Bayejid-pro repo theke bby.js
 * ```
 *
 * That text must NOT become an actual GitHub command.
 */

function stripCodeBlocks(
  text: string
) {
  return text
    .replace(
      /```[\s\S]*?```/g,
      " "
    )
    .trim();
}

/*
 * Detect requests that are actually asking
 * the AI to modify source code.
 *
 * These MUST NOT go through simple direct
 * file add/update parsing.
 */

function isCodeEditRequest(
  text: string
) {
  const value =
    normalize(
      stripCodeBlocks(text)
    );

  const hasCodeTarget =
    /(?:function|code|section|part|file|github-agent\.ts|\.ts|\.js|\.tsx|\.jsx|অংশ)/i.test(
      value
    );

  const hasEditLanguage =
    /(?:replace|modify|change|edit|refactor|update|fix|rewrite|পরিবর্তন|বদল|ঠিক কর|replace করে|পুরো replace)/i.test(
      value
    );

  /*
   * Strong explicit development wording.
   */
  if (
    hasCodeTarget &&
    hasEditLanguage
  ) {
    return true;
  }

  if (
    value.includes(
      "এই function"
    ) ||
    value.includes(
      "এই অংশটা"
    ) ||
    value.includes(
      "current function"
    ) ||
    value.includes(
      "function er pore"
    ) ||
    value.includes(
      "function-এর পরে"
    )
  ) {
    return true;
  }

  return false;
}

function isGreeting(
  text: string
) {
  const value =
    normalize(text);

  return [
    "hi",
    "hello",
    "hey",
    "hii",
    "hiii",
    "yo",
    "hi there",
    "hello there",
    "hey there",
    "thanks",
    "thank you",
    "ok",
    "okay",
    "good morning",
    "good night",
    "how are you",
    "who are you"
  ].includes(value);
}

function isListRepos(
  text: string
) {
  const value =
    normalize(text);

  return (
    /^(show|list|get)\s+(my\s+)?(repos?|repositories)/i.test(
      value
    ) ||
    value.includes(
      "repo gula dekhao"
    ) ||
    value.includes(
      "repository gula dekhao"
    ) ||
    value.includes(
      "amar repo dekhao"
    ) ||
    value.includes(
      "all repos"
    ) ||
    value.includes(
      "sob repo"
    ) ||
    value.includes(
      "সব repo"
    ) ||
    value.includes(
      "সব repository"
    )
  );
}

/*
 * =========================================================
 * REPOSITORY NAME EXTRACTION
 * =========================================================
 */

function extractRepoName(
  text: string
) {
  const clean =
    stripCodeBlocks(text);

  const patterns = [
    /(?:new|create|make)\s+(?:a\s+)?repo(?:sitory)?\s+(?:named\s+|name\s+)?["'`]?([a-zA-Z0-9_.-]+)["'`]?/i,

    /(?:repo|repository)\s+(?:banao|create|banai|বানাও)\s+(?:["'`])?([a-zA-Z0-9_.-]+)(?:["'`])?/i,

    /(?:new\s+repo|repo\s+banao).*?\b(?:name\s+diye|name\s+is|named)\s+["'`]?([a-zA-Z0-9_.-]+)["'`]?/i
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      clean.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/*
 * =========================================================
 * REPO + PATH EXTRACTION
 * =========================================================
 *
 * Supported:
 *
 * Bayejid-pro repo theke bby.js
 * Bayejid-pro repository theke bby.js
 * Github theke Bayejid-pro repo theke bby.js
 * Bayejid-pro repository থেকে bby.js
 * repo Bayejid-pro থেকে bby.js
 * Bayejid-pro repo te scripts/bby.js
 *
 * IMPORTANT:
 * This parser is only used for simple GitHub
 * operations. Code-edit requests are filtered
 * before directAction().
 */

function extractRepoAndPath(
  text: string
) {
  const clean =
    stripCodeBlocks(text);

  const patterns = [
    /*
     * Github theke Bayejid-pro repo theke bby.js
     */
    /(?:github\s+theke\s+)?["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo|repository)\s+(?:theke|from|থেকে)\s+["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?/i,

    /*
     * Bayejid-pro repo theke bby.js
     */
    /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo(?:sitory)?)?\s*(?:theke|from|থেকে)\s+["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?/i,

    /*
     * Bayejid-pro repository theke bby.js
     */
    /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo|repository)\s+(?:theke|from|থেকে)\s+["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?/i,

    /*
     * repo Bayejid-pro theke bby.js
     */
    /(?:repo|repository)\s+["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:theke|from|থেকে)\s+["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?/i,

    /*
     * Bayejid-pro repo te bby.js
     */
    /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo|repository)\s+(?:te|in|তে)\s+["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?/i
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      clean.match(pattern);

    if (
      match?.[1] &&
      match?.[2]
    ) {
      return {
        repo: match[1],
        path: match[2]
      };
    }
  }

  return null;
}

/*
 * =========================================================
 * CREATE FILE REQUEST
 * =========================================================
 *
 * Examples:
 *
 * Banao repository te new file banao games.js name er - //games Example
 *
 * Banao repo te games.js add koro - hello
 *
 * Banao repository te new file create games.js - test
 */

function extractCreateFileRequest(
  text: string
) {
  const clean =
    stripCodeBlocks(text);

  const patterns = [
    /*
     * Banao repository te new file banao games.js name er - content
     */
    /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo|repository)\s+(?:te|in|তে)\s+(?:a\s+|new\s+)?file\s+(?:banao|create|make|add|বানাও|করো)\s+["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?(?:\s+(?:name\s+er|named|name)\s*)?(?:-|:)\s*([\s\S]+)$/i,

    /*
     * Banao repository te games.js add koro - content
     */
    /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo|repository)\s+(?:te|in|তে)\s+["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?\s+(?:add|create|make|banao|বানাও|যোগ)\s+(?:koro|করো)?\s*(?:-|:)\s*([\s\S]+)$/i,

    /*
     * Banao repo te new file banao games.js - content
     */
    /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo|repository)\s+(?:te|in|তে)\s+(?:new\s+)?file\s+(?:banao|create|make)\s+["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?.*?(?:-|:)\s*([\s\S]+)$/i
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      clean.match(pattern);

    if (
      match?.[1] &&
      match?.[2]
    ) {
      return {
        repo: match[1],
        path: match[2],
        content:
          match[3]?.trim() || ""
      };
    }
  }

  return null;
}

/*
 * =========================================================
 * FILE NAME EXTRACTION
 * =========================================================
 */

function extractFileName(
  text: string
) {
  const clean =
    stripCodeBlocks(text);

  const matches =
    clean.match(
      /(?:^|[\s"'`])([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.[a-zA-Z0-9_-]+)(?=$|[\s"'`])/g
    );

  if (!matches?.length) {
    return null;
  }

  return matches[0]
    .trim()
    .replace(
      /^["'`\s]+|["'`\s]+$/g,
      ""
    );
}

/*
 * =========================================================
 * INTENT HELPERS
 * =========================================================
 */

function wantsRead(
  text: string
) {
  const value =
    normalize(
      stripCodeBlocks(text)
    );

  return (
    /\b(?:dao|show|read|dekhao|fetch|pathao|find|khuj)\b/i.test(
      value
    ) ||
    value.includes("দাও") ||
    value.includes("দেখাও") ||
    value.includes("পাঠাও") ||
    value.includes("খুঁজ")
  );
}

function wantsDelete(
  text: string
) {
  const value =
    normalize(
      stripCodeBlocks(text)
    );

  return (
    /\b(?:delete|remove)\b/i.test(
      value
    ) ||
    value.includes("ডিলিট") ||
    value.includes("মুছে")
  );
}

/*
 * IMPORTANT:
 *
 * Do NOT simply search for "update", "edit",
 * "add" anywhere in a long user message.
 *
 * That caused the old bug where a code-edit
 * instruction containing the word "update"
 * accidentally updated bby.js.
 */

function wantsWrite(
  text: string
) {
  const value =
    normalize(
      stripCodeBlocks(text)
    );

  return (
    /\b(?:add|create|make|write)\s+(?:a\s+)?(?:new\s+)?file\b/i.test(
      value
    ) ||
    /\b(?:create|make|add|write)\b.*\bfile\b/i.test(
      value
    ) ||
    value.includes("create file") ||
    value.includes("make file") ||
    value.includes("file banao") ||
    value.includes("file বানাও") ||
    value.includes("file add koro") ||
    value.includes("file update koro") ||
    value.includes("যোগ করো") ||
    value.includes("নতুন file")
  );
}

function hasConfirmation(
  text: string
) {
  const value =
    normalize(text);

  return (
    value.includes("confirm") ||
    value.includes("i confirm") ||
    value.includes("yes delete") ||
    value.includes(
      "হ্যাঁ delete"
    ) ||
    value.includes(
      "হ্যাঁ ডিলিট"
    )
  );
}

/*
 * =========================================================
 * CONTENT EXTRACTION
 * =========================================================
 */

function extractContent(
  text: string
) {
  const clean =
    stripCodeBlocks(text);

  const patterns = [
    /\s+-\s+([\s\S]+)$/,

    /\s+content\s*[:=]\s*([\s\S]+)$/i,

    /\s+with\s+content\s+([\s\S]+)$/i,

    /\s+containing\s+([\s\S]+)$/i
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      clean.match(pattern);

    if (
      match?.[1]?.trim()
    ) {
      return match[1].trim();
    }
  }

  return null;
}

/*
 * =========================================================
 * EMPTY REPOSITORY FIRST COMMIT
 * =========================================================
 */

async function createFirstFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string
) {
  const repository =
    await getRepo(
      owner,
      repo
    );

  const branch =
    repository.default_branch ||
    "main";

  const blob =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner
      )}/${encodeURIComponent(
        repo
      )}/git/blobs`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          content,
          encoding: "utf-8"
        })
      }
    );

  const tree =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner
      )}/${encodeURIComponent(
        repo
      )}/git/trees`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          tree: [
            {
              path,
              mode: "100644",
              type: "blob",
              sha: blob.sha
            }
          ]
        })
      }
    );

  const commit =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner
      )}/${encodeURIComponent(
        repo
      )}/git/commits`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          message,
          tree: tree.sha
        })
      }
    );

  const ref =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner
      )}/${encodeURIComponent(
        repo
      )}/git/refs`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          ref:
            `refs/heads/${branch}`,
          sha: commit.sha
        })
      }
    );

  return {
    branch,
    commit,
    ref
  };
}

/*
 * =========================================================
 * SMART FILE WRITE
 * =========================================================
 */

async function createFileSmart(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string
) {
  const repository =
    await getRepo(
      owner,
      repo
    );

  if (
    Number(
      repository.size || 0
    ) === 0
  ) {
    return createFirstFile(
      owner,
      repo,
      path,
      content,
      message
    );
  }

  return createOrUpdateFile(
    owner,
    repo,
    path,
    content,
    message
  );
}

/*
 * =========================================================
 * MULTI-TURN CONTEXT
 * =========================================================
 */

function isPossibleRepoName(
  text: string
) {
  return /^[a-zA-Z0-9_.-]+$/.test(
    text.trim()
  );
}

function findPreviousFileRequest(
  messages: ChatInputMessage[]
) {
  const reversed =
    [...messages].reverse();

  for (
    const message of reversed
  ) {
    if (
      message.role !== "user" ||
      !message.content
    ) {
      continue;
    }

    const content =
      message.content.trim();

    /*
     * Do not parse code-edit messages as
     * previous GitHub commands.
     */
    if (
      isCodeEditRequest(content)
    ) {
      continue;
    }

    const createRequest =
      extractCreateFileRequest(
        content
      );

    if (createRequest) {
      return {
        repo:
          createRequest.repo,
        path:
          createRequest.path
      };
    }

    const repoPath =
      extractRepoAndPath(
        content
      );

    if (repoPath) {
      return repoPath;
    }

    const file =
      extractFileName(
        content
      );

    if (file) {
      return {
        repo: null,
        path: file
      };
    }
  }

  return null;
}

/*
 * =========================================================
 * DIRECT ACTION ENGINE
 * =========================================================
 */

async function directAction(
  text: string
) {
  /*
   * Code-edit requests must NEVER enter
   * this simple-operation engine.
   */

  if (
    isCodeEditRequest(text)
  ) {
    return {
      handled: false
    };
  }

  if (
    isGreeting(text)
  ) {
    return {
      handled: true,
      message:
        "Hello! 👋 I'm your GitHub AI Manager. I can manage repositories, files, branches, commits and pull requests."
    };
  }

  const owner =
    await getOwner();

  /*
   * -------------------------------------------------------
   * LIST REPOSITORIES
   * -------------------------------------------------------
   */

  if (
    isListRepos(text)
  ) {
    const repos =
      await listRepos();

    if (!repos.length) {
      return {
        handled: true,
        message:
          "📁 No repositories found."
      };
    }

    const result =
      repos
        .map(
          (repo: any) =>
            `• ${repo.name} — ${
              repo.private
                ? "Private"
                : "Public"
            }`
        )
        .join("\n");

    return {
      handled: true,
      message:
        `📁 Your GitHub repositories:\n\n${result}`
    };
  }

  /*
   * -------------------------------------------------------
   * CREATE REPOSITORY
   * -------------------------------------------------------
   */

  const newRepo =
    extractRepoName(text);

  if (newRepo) {
    const repo =
      await createRepo(
        newRepo,
        "",
        false
      );

    return {
      handled: true,
      refreshRepos: true,
      message:
        `✅ Created public repository **${repo.name}**.\n\n${repo.html_url || ""}`
    };
  }

  /*
   * -------------------------------------------------------
   * CREATE NEW FILE
   * -------------------------------------------------------
   *
   * This MUST happen before generic repo+path
   * handling because:
   *
   * Banao repository te new file banao games.js
   *
   * does not use "theke/from".
   */

  const createFileRequest =
    extractCreateFileRequest(
      text
    );

  if (
    createFileRequest
  ) {
    const {
      repo,
      path,
      content
    } = createFileRequest;

    if (!content) {
      return {
        handled: true,
        message:
          `I found **${path}**, but no file content was provided.`
      };
    }

    const result =
      await createFileSmart(
        owner,
        repo,
        path,
        content,
        `Add ${path}`
      );

    return {
      handled: true,
      message:
        `✅ **${path}** was added/updated in **${repo}**.\n\nCommit: \`${result.commit?.sha || "created"}\``
    };
  }

  /*
   * -------------------------------------------------------
   * REPO + FILE
   * -------------------------------------------------------
   */

  const repoPath =
    extractRepoAndPath(text);

  if (repoPath) {
    const {
      repo,
      path
    } = repoPath;

    /*
     * DELETE FILE
     */

    if (
      wantsDelete(text)
    ) {
      if (
        !hasConfirmation(text)
      ) {
        return {
          handled: true,
          message:
            `⚠️ Deleting **${path}** is destructive.\n\nReply with:\n\`CONFIRM DELETE FILE ${path}\``
        };
      }

      const result =
        await deleteFile(
          owner,
          repo,
          path,
          `Delete ${path}`
        );

      return {
        handled: true,
        message:
          `🗑️ Deleted **${path}** from **${repo}**.\n\nCommit: \`${result.commit?.sha || "created"}\``
      };
    }

    /*
     * WRITE FILE
     */

    if (
      wantsWrite(text)
    ) {
      const content =
        extractContent(text);

      if (!content) {
        return {
          handled: true,
          message:
            `I found **${path}**, but I couldn't determine the content to write.\n\nExample:\n\`${repo} repo te README.md add koro - hi this is an example repo\``
        };
      }

      const result =
        await createFileSmart(
          owner,
          repo,
          path,
          content,
          `Add/update ${path}`
        );

      return {
        handled: true,
        message:
          `✅ **${path}** was added/updated in **${repo}**.\n\nCommit: \`${result.commit?.sha || "created"}\``
      };
    }

    /*
     * READ FILE
     */

    if (
      wantsRead(text)
    ) {
      const result =
        await findAndReadFile(
          owner,
          repo,
          path
        );

      if (
        !result.found
      ) {
        if (
          result.ambiguous
        ) {
          const matches =
            result.matches
              ?.map(
                (item) =>
                  `• ${item.path}`
              )
              .join("\n");

          return {
            handled: true,
            message:
              `🔎 Multiple files matched **${path}**:\n\n${matches}\n\nPlease specify the exact path.`
          };
        }

        return {
          handled: true,
          message:
            `❌ **${path}** was not found in **${repo}**.`
        };
      }

      return {
        handled: true,
        message:
          `📄 **${result.path}**\n\n\`\`\`\n${result.content || ""}\n\`\`\``
      };
    }
  }

  /*
   * -------------------------------------------------------
   * FILE SEARCH WITHOUT EXACT REPO + PATH PATTERN
   * -------------------------------------------------------
   */

  const fileName =
    extractFileName(text);

  if (
    fileName &&
    wantsRead(text)
  ) {
    const repoMatch =
      stripCodeBlocks(text).match(
        /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo|repository)?\s*(?:theke|from|থেকে)/i
      );

    if (
      repoMatch?.[1]
    ) {
      const repo =
        repoMatch[1];

      const result =
        await findAndReadFile(
          owner,
          repo,
          fileName
        );

      if (
        result.found
      ) {
        return {
          handled: true,
          message:
            `📄 **${result.path}**\n\n\`\`\`\n${result.content || ""}\n\`\`\``
        };
      }

      if (
        result.ambiguous
      ) {
        return {
          handled: true,
          message:
            `🔎 Multiple **${fileName}** files were found:\n\n${result.matches
              ?.map(
                (item) =>
                  `• ${item.path}`
              )
              .join("\n")}\n\nPlease specify the exact path.`
        };
      }

      return {
        handled: true,
        message:
          `❌ **${fileName}** was not found in **${repo}**.`
      };
    }
  }

  /*
   * -------------------------------------------------------
   * DELETE REPOSITORY
   * -------------------------------------------------------
   */

  const deleteRepoMatch =
    stripCodeBlocks(text).match(
      /(?:delete|remove)\s+(?:repo(?:sitory)?\s+)?["'`]?([a-zA-Z0-9_.-]+)["'`]?/i
    );

  if (
    deleteRepoMatch?.[1]
  ) {
    const repo =
      deleteRepoMatch[1];

    if (
      !hasConfirmation(text)
    ) {
      return {
        handled: true,
        message:
          `⚠️ Deleting repository **${repo}** is permanent.\n\nReply with:\n\`CONFIRM DELETE REPOSITORY ${repo}\``
      };
    }

    await deleteRepo(
      owner,
      repo
    );

    return {
      handled: true,
      refreshRepos: true,
      message:
        `🗑️ Repository **${repo}** was deleted successfully.`
    };
  }

  /*
   * -------------------------------------------------------
   * CREATE BRANCH
   * -------------------------------------------------------
   */

  const branchMatch =
    stripCodeBlocks(text).match(
      /(?:create|make|new)\s+branch\s+["'`]?([a-zA-Z0-9_.\/-]+)["'`]?\s+(?:from|on)\s+["'`]?([a-zA-Z0-9_.\/-]+)["'`]?.*?(?:repo|repository)\s+["'`]?([a-zA-Z0-9_.-]+)["'`]?/i
    );

  if (
    branchMatch
  ) {
    const [
      ,
      branch,
      from,
      repo
    ] = branchMatch;

    const result =
      await createBranch(
        owner,
        repo,
        branch,
        from
      );

    return {
      handled: true,
      message:
        `🌿 Branch **${branch}** was created in **${repo}** from **${from}**.\n\nRef: \`${result.ref || "created"}\``
    };
  }

  return {
    handled: false
  };
}

/*
 * =========================================================
 * GROQ TOOLS
 * =========================================================
 */

const aiTools = [
  {
    type: "function",
    function: {
      name: "get_repository",
      description:
        "Get detailed information about a GitHub repository.",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string"
          },
          repo: {
            type: "string"
          }
        },
        required: [
          "owner",
          "repo"
        ],
        additionalProperties: false
      }
    }
  },

  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a GitHub file before modifying it or when its contents are needed.",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string"
          },
          repo: {
            type: "string"
          },
          path: {
            type: "string"
          },
          ref: {
            type: "string"
          }
        },
        required: [
          "owner",
          "repo",
          "path"
        ],
        additionalProperties: false
      }
    }
  },

  {
    type: "function",
    function: {
      name: "update_file",
      description:
        "Update an existing GitHub file or create a file when appropriate. Always read the existing file first when modifying existing code.",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string"
          },
          repo: {
            type: "string"
          },
          path: {
            type: "string"
          },
          content: {
            type: "string"
          },
          message: {
            type: "string"
          },
          branch: {
            type: "string"
          }
        },
        required: [
          "owner",
          "repo",
          "path",
          "content",
          "message"
        ],
        additionalProperties: false
      }
    }
  },

  {
    type: "function",
    function: {
      name: "create_branch",
      description:
        "Create a GitHub branch when a branch operation is required.",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string"
          },
          repo: {
            type: "string"
          },
          branch: {
            type: "string"
          },
          from: {
            type: "string"
          }
        },
        required: [
          "owner",
          "repo",
          "branch",
          "from"
        ],
        additionalProperties: false
      }
    }
  },

  {
    type: "function",
    function: {
      name: "create_pull_request",
      description:
        "Create a GitHub pull request.",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string"
          },
          repo: {
            type: "string"
          },
          title: {
            type: "string"
          },
          head: {
            type: "string"
          },
          base: {
            type: "string"
          },
          body: {
            type: "string"
          }
        },
        required: [
          "owner",
          "repo",
          "title",
          "head",
          "base"
        ],
        additionalProperties: false
      }
    }
  }
];

/*
 * =========================================================
 * AI TOOL EXECUTION
 * =========================================================
 */

async function executeAiTool(
  name: string,
  args: Record<string, any>
) {
  /*
   * Always prefer the connected GitHub account
   * when owner is missing or incorrect.
   */

  const connectedOwner =
    await getOwner();

  const owner =
    connectedOwner;

  switch (name) {
    case "get_repository":
      return getRepo(
        owner,
        args.repo
      );

    case "read_file":
      return readFile(
        owner,
        args.repo,
        args.path,
        args.ref
      );

    case "update_file":
      return createFileSmart(
        owner,
        args.repo,
        args.path,
        args.content,
        args.message
      );

    case "create_branch":
      return createBranch(
        owner,
        args.repo,
        args.branch,
        args.from
      );

    case "create_pull_request":
      return createPullRequest(
        owner,
        args.repo,
        args.title,
        args.head,
        args.base,
        args.body || ""
      );

    default:
      throw new Error(
        `Unknown AI tool: ${name}`
      );
  }
}

/*
 * =========================================================
 * MAIN AGENT
 * =========================================================
 */

export async function runGitHubAgent(
  messages: ChatInputMessage[]
) {
  const userMessages =
    messages.filter(
      (message) =>
        message.role === "user" &&
        Boolean(
          message.content?.trim()
        )
    );

  const latest =
    userMessages[
      userMessages.length - 1
    ];

  const text =
    latest?.content?.trim() ||
    "";

  if (!text) {
    return {
      message:
        "Please enter a message.",
      refreshRepos: false
    };
  }

  /*
   * -------------------------------------------------------
   * CODE EDIT REQUEST
   * -------------------------------------------------------
   *
   * IMPORTANT:
   *
   * This check happens BEFORE directAction().
   *
   * Therefore a message such as:
   *
   * "github-agent.ts-এ এই function replace করো..."
   *
   * cannot accidentally trigger:
   *
   * Bayejid-pro/bby.js
   */

  const codeEditRequest =
    isCodeEditRequest(text);

  /*
   * -------------------------------------------------------
   * DIRECT MULTI-TURN CONTEXT
   * -------------------------------------------------------
   */

  let effectiveText =
    text;

  if (
    !codeEditRequest
  ) {
    const previousRequest =
      findPreviousFileRequest(
        userMessages.slice(
          0,
          -1
        )
      );

    /*
     * If the latest message is a repo name
     * and the previous request contained a file,
     * continue the previous task.
     *
     * Example:
     *
     * User:
     * bby.js dao
     *
     * User:
     * Bayejid-pro
     */

    if (
      isPossibleRepoName(text) &&
      previousRequest?.path
    ) {
      effectiveText =
        `${text} repo theke ${previousRequest.path} dao`;
    }
  }

  /*
   * -------------------------------------------------------
   * DIRECT ACTION FIRST
   * -------------------------------------------------------
   *
   * Code-edit tasks intentionally skip this.
   */

  if (
    !codeEditRequest
  ) {
    const direct =
      await directAction(
        effectiveText
      );

    if (
      direct.handled
    ) {
      return {
        message:
          direct.message ||
          "Done.",
        refreshRepos:
          Boolean(
            direct.refreshRepos
          )
      };
    }
  }

  /*
   * -------------------------------------------------------
   * GROQ REASONING
   * -------------------------------------------------------
   */

  const connectedOwner =
    await getOwner();

  const conversation:
    AgentMessage[] = [
      {
        role: "system",
        content: `
You are an advanced GitHub Manager AI.

Connected GitHub owner:
${connectedOwner}

The server handles simple GitHub operations directly.

Use reasoning for:
- debugging
- explaining code
- fixing code
- generating code
- architecture
- complex repository tasks
- multi-step development tasks
- editing existing source files

IMPORTANT CODE-EDIT RULES:

1. If the user asks to modify, replace, fix, refactor, or update code inside a file, treat it as a CODE EDIT TASK.

2. For a code-edit task:
   - identify the actual repository and target file from the user's natural-language request
   - read the target file first
   - apply the requested changes
   - preserve unrelated existing code
   - update the same target file
   - use update_file
   - only report success after update_file succeeds

3. NEVER treat examples inside code snippets, comments, regex examples, documentation, or quoted text as the user's actual GitHub command.

4. For example, if a user asks you to modify github-agent.ts and their replacement code contains:
   "Bayejid-pro repo theke bby.js"
   that is an example inside the code and MUST NOT cause a bby.js operation.

5. Never invent repository names or file paths.

6. The connected GitHub owner is already known:
   ${connectedOwner}

7. Never ask the user for the GitHub owner unless there is a genuine authentication problem.

8. Never claim a GitHub action succeeded unless the corresponding tool returned successfully.

9. If a tool returns an error, report the actual error instead of claiming success.

10. When updating code, read the existing file before replacing it unless the user explicitly says the file is completely new.

11. Keep responses concise.

12. Do not unnecessarily use Groq for simple read/list/create-file operations that the server can handle directly.
`
      },
      ...messages
    ];

  let refreshRepos =
    false;

  /*
   * Maximum 4 reasoning rounds.
   */

  for (
    let step = 0;
    step < 4;
    step++
  ) {
    const response =
      await groqChat(
        conversation,
        aiTools
      );

    const assistant =
      response?.choices?.[0]
        ?.message;

    if (!assistant) {
      throw new Error(
        "Groq returned an empty response."
      );
    }

    conversation.push({
      role: "assistant",
      content:
        assistant.content ||
        null,
      tool_calls:
        assistant.tool_calls ||
        undefined
    });

    const calls =
      assistant.tool_calls ||
      [];

    /*
     * Normal AI response.
     */

    if (!calls.length) {
      return {
        message:
          assistant.content ||
          "Done.",
        refreshRepos
      };
    }

    /*
     * Execute tools.
     */

    for (
      const call of calls
    ) {
      const name =
        call?.function?.name;

      if (!name) {
        continue;
      }

      let args:
        Record<string, any>;

      try {
        args =
          JSON.parse(
            call.function
              .arguments ||
              "{}"
          );
      } catch {
        throw new Error(
          `Invalid arguments for ${name}.`
        );
      }

      const result =
        await executeAiTool(
          name,
          args
        );

      conversation.push({
        role: "tool",
        tool_call_id:
          call.id,
        name,
        content:
          JSON.stringify(result)
      });

      if (
        name === "update_file" ||
        name === "create_branch" ||
        name ===
          "create_pull_request"
      ) {
        refreshRepos =
          true;
      }
    }
  }

  return {
    message:
      "The AI reached its reasoning limit. Please continue the task.",
    refreshRepos
  };
}
