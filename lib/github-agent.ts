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
  mergePullRequest,
  readFile
} from "./github";

import {
  findAndReadFile,
  findFiles
} from "./file-finder";

import { groqChat } from "./groq";

const GITHUB_API = "https://api.github.com";

/*
 * ---------------------------------------------------------
 * TYPES
 * ---------------------------------------------------------
 */

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

type ChatInputMessage = {
  role: "user" | "assistant";
  content?: string | null;
};

/*
 * ---------------------------------------------------------
 * GITHUB HELPERS
 * ---------------------------------------------------------
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

  return user.login;
}

/*
 * ---------------------------------------------------------
 * TEXT PARSING
 * ---------------------------------------------------------
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
    )
  );
}

function extractRepoName(
  text: string
) {
  const patterns = [
    /(?:new|create|make)\s+(?:a\s+)?repo(?:sitory)?\s+(?:named\s+|name\s+)?["'`]?([a-zA-Z0-9_.-]+)["'`]?/i,

    /(?:repo|repository)\s+(?:banao|create|banai|বানাও)\s+(?:["'`])?([a-zA-Z0-9_.-]+)(?:["'`])?/i,

    /(?:new\s+repo|repo\s+banao).*?\b(?:name\s+diye|name\s+is|named)\s+["'`]?([a-zA-Z0-9_.-]+)["'`]?/i
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      text.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractRepoAndPath(
  text: string
) {
  const patterns = [
    /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo(?:sitory)?\s+)?(?:theke|from)\s+["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?/i,

    /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo(?:sitory)?\s+)?(?:te|the)\s+["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?/i,

    /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:repo|repository)\s+.*?["'`]?([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9_-]+)["'`]?/i
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      text.match(pattern);

    if (match) {
      return {
        repo: match[1],
        path: match[2]
      };
    }
  }

  return null;
}

function extractFileName(
  text: string
) {
  const matches =
    text.match(
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

function wantsRead(
  text: string
) {
  const value =
    normalize(text);

  return (
    value.includes("dao") ||
    value.includes("দাও") ||
    value.includes("show") ||
    value.includes("read") ||
    value.includes("dekhao") ||
    value.includes("দেখাও") ||
    value.includes("fetch")
  );
}

function wantsDelete(
  text: string
) {
  const value =
    normalize(text);

  return (
    value.includes("delete") ||
    value.includes("remove") ||
    value.includes("ডিলিট") ||
    value.includes("মুছে")
  );
}

function wantsWrite(
  text: string
) {
  const value =
    normalize(text);

  return (
    value.includes("add") ||
    value.includes("create file") ||
    value.includes("make file") ||
    value.includes("write") ||
    value.includes("update") ||
    value.includes("edit") ||
    value.includes("যোগ") ||
    value.includes("বানাও")
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
 * FIX:
 *
 * Previous version used the RegExp /s flag.
 * Your tsconfig targets ES2017, so TypeScript
 * rejected that flag.
 *
 * [\s\S] works on all supported targets.
 */

function extractContent(
  text: string
) {
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
      text.match(pattern);

    if (
      match?.[1]?.trim()
    ) {
      return match[1].trim();
    }
  }

  return null;
}

/*
 * ---------------------------------------------------------
 * EMPTY REPOSITORY FIRST COMMIT
 * ---------------------------------------------------------
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

  /*
   * 1. Create blob
   */

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

  /*
   * 2. Create tree
   */

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

  /*
   * 3. Create first commit
   */

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

  /*
   * 4. Create branch reference
   */

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
          ref: `refs/heads/${branch}`,
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
 * ---------------------------------------------------------
 * SMART FILE CREATION
 * ---------------------------------------------------------
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

  /*
   * IMPORTANT FIX:
   *
   * Do NOT require default_branch to be empty.
   * GitHub can report a default branch name even
   * when the repository has no commits.
   *
   * Repository size 0 is the important check.
   */

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
 * ---------------------------------------------------------
 * DIRECT ACTIONS
 * ---------------------------------------------------------
 */

async function directAction(
  text: string
) {
  /*
   * GREETING
   */

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
   * LIST REPOSITORIES
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
   * CREATE REPOSITORY
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
   * REPOSITORY + FILE
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
   * FILE SEARCH WITHOUT FULL PATH
   *
   * Example:
   * Bayejid-pro থেকে bby.js দাও
   */

  const fileName =
    extractFileName(text);

  if (
    fileName &&
    wantsRead(text)
  ) {
    const repoMatch =
      text.match(
        /["'`]?([a-zA-Z0-9_.-]+)["'`]?\s+(?:theke|from|repo|repository)/i
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
   * DELETE REPOSITORY
   */

  const deleteRepoMatch =
    text.match(
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
   * CREATE BRANCH
   */

  const branchMatch =
    text.match(
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
 * ---------------------------------------------------------
 * GROQ TOOLS
 * ---------------------------------------------------------
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
        "Read a GitHub file when AI needs the contents for reasoning.",
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
        "Update a GitHub file after AI has generated/fixed its content.",
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
        "Create a GitHub branch when AI determines a branch is needed.",
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
 * ---------------------------------------------------------
 * AI TOOL EXECUTION
 * ---------------------------------------------------------
 */

async function executeAiTool(
  name: string,
  args: Record<string, any>
) {
  switch (name) {
    case "get_repository":
      return getRepo(
        args.owner,
        args.repo
      );

    case "read_file":
      return readFile(
        args.owner,
        args.repo,
        args.path,
        args.ref
      );

    case "update_file":
      return createOrUpdateFile(
        args.owner,
        args.repo,
        args.path,
        args.content,
        args.message,
        args.branch
      );

    case "create_branch":
      return createBranch(
        args.owner,
        args.repo,
        args.branch,
        args.from
      );

    case "create_pull_request":
      return createPullRequest(
        args.owner,
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
 * ---------------------------------------------------------
 * MAIN GITHUB AGENT
 * ---------------------------------------------------------
 */

export async function runGitHubAgent(
  messages: ChatInputMessage[]
) {
  const latest =
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role ===
          "user"
      );

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
   * Direct action first.
   *
   * Simple requests such as:
   * - Hi
   * - list repos
   * - create repo
   * - read file
   *
   * will not consume Groq unnecessarily.
   */

  const direct =
    await directAction(text);

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

  /*
   * -------------------------------------------------------
   * COMPLEX REASONING
   * -------------------------------------------------------
   */

  const conversation:
    AgentMessage[] = [
      {
        role: "system",
        content: `
You are an advanced GitHub Manager AI.

The server already handles simple GitHub operations directly.

Use your reasoning for:
- debugging
- explaining code
- fixing code
- generating code
- architecture
- complex repository tasks
- multi-step development tasks

Rules:
1. Never claim an action succeeded unless a tool succeeded.
2. Preserve existing code unless replacement is explicitly requested.
3. Read existing code before changing it.
4. Never invent repository names or file paths.
5. Keep responses concise.
6. If a user asks for a simple file read, do not unnecessarily use AI.
7. If a GitHub operation can be safely performed directly, use the provided tool.
`
      },
      ...messages
    ];

  let refreshRepos =
    false;

  /*
   * Maximum 4 Groq reasoning rounds.
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

    /*
     * FIX:
     *
     * AgentMessage allows tool_calls.
     */

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
     * No tool call means final AI response.
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
     * Execute every tool call.
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

      /*
       * FIX:
       *
       * AgentMessage allows role "tool",
       * tool_call_id and name.
       */

      conversation.push({
        role: "tool",
        tool_call_id:
          call.id,
        name,
        content:
          JSON.stringify(result)
      });

      /*
       * If an AI tool updates a repository,
       * tell the UI to refresh repository data.
       */

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
