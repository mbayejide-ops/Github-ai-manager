import { NextResponse } from "next/server";

import {
  createBranch,
  createOrUpdateFile,
  createPullRequest,
  createRepo,
  deleteFile,
  deleteRepo,
  getRepo,
  listRepos,
  mergePullRequest,
  readFile
} from "@/lib/github";

import { findAndReadFile } from "@/lib/file-finder";
import { groqChat } from "@/lib/groq";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

function getLatestUserMessage(messages: ChatMessage[]) {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "user" &&
        typeof message.content === "string"
    );
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detect simple conversational messages.
 * These should never touch GitHub.
 */
function isSimpleChat(text: string) {
  const value = normalizeText(text);

  const patterns = [
    /^hi$/,
    /^hello$/,
    /^hey$/,
    /^hi there$/,
    /^hello there$/,
    /^hey there$/,
    /^hii+$/,
    /^helloo+$/,
    /^yo$/,
    /^thanks$/,
    /^thank you$/,
    /^ok$/,
    /^okay$/,
    /^good$/,
    /^good morning$/,
    /^good night$/,
    /^how are you$/,
    /^who are you$/,
    /^what can you do$/
  ];

  return patterns.some((pattern) =>
    pattern.test(value)
  );
}

/**
 * Extract "repo" and "file" from common natural language.
 *
 * Examples:
 *   Example repo te README.md add koro
 *   Example name er repo te redeme add koro
 *   Bayejid-pro theke bby.js dao
 */
function extractRepoAndFile(text: string) {
  const value = text.trim();

  const patterns = [
    /(?:repo(?:sitory)?\s+)?["'`]?([A-Za-z0-9_.-]+)["'`]?\s+(?:repo(?:sitory)?\s+)?(?:te|theke|from|in|into|inside)\s+["'`]?([A-Za-z0-9_.\/-]+\.[A-Za-z0-9_-]+)["'`]?/i,

    /["'`]?([A-Za-z0-9_.-]+)["'`]?\s+(?:name\s+er\s+)?repo(?:sitory)?\s+(?:te|theke|from|in|into)\s+["'`]?([A-Za-z0-9_.\/-]+\.[A-Za-z0-9_-]+)["'`]?/i,

    /["'`]?([A-Za-z0-9_.-]+)["'`]?\s+(?:repo|repository)\s+["'`]?([A-Za-z0-9_.\/-]+\.[A-Za-z0-9_-]+)["'`]?/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match) {
      return {
        repo: match[1],
        path: match[2]
      };
    }
  }

  return null;
}

/**
 * Extract a repository name from simple repository commands.
 */
function extractRepoName(text: string) {
  const value = text.trim();

  const patterns = [
    /(?:new\s+)?repo(?:sitory)?\s+(?:banao|create|make)\s+["'`]?([A-Za-z0-9_.-]+)["'`]?/i,

    /(?:new\s+)?["'`]?([A-Za-z0-9_.-]+)["'`]?\s+(?:name\s+)?(?:er\s+)?repo(?:sitory)?\s+(?:banao|create|make)/i,

    /(?:repo(?:sitory)?)\s+name\s+(?:is|=)\s+["'`]?([A-Za-z0-9_.-]+)["'`]?/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Extract a file path from a message.
 */
function extractFilePath(text: string) {
  const matches = text.match(
    /(?:^|[\s"'`])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.[A-Za-z0-9_-]+)(?=$|[\s"'`])/g
  );

  if (!matches || matches.length === 0) {
    return null;
  }

  return matches[0]
    .trim()
    .replace(/^["'`\s]+|["'`\s]+$/g, "");
}

/**
 * Try to extract content from:
 *
 * Example:
 *   Example repo te README.md add koro - hi this is example
 */
function extractFileContent(text: string) {
  const separators = [
    /\s+-\s+/i,
    /\s*:\s*/i,
    /\s+content\s*=\s*/i,
    /\s+with\s+/i,
    /\s+containing\s+/i
  ];

  for (const separator of separators) {
    const parts = text.split(separator);

    if (parts.length >= 2) {
      const content = parts
        .slice(1)
        .join(" ")
        .trim();

      if (content) {
        return content;
      }
    }
  }

  return null;
}

function wantsListRepos(text: string) {
  const value = normalizeText(text);

  return (
    value.includes("list repo") ||
    value.includes("show repo") ||
    value.includes("all repo") ||
    value.includes("my repo") ||
    value.includes("repositories dekhao") ||
    value.includes("repo gula dekhao")
  );
}

function wantsCreateRepo(text: string) {
  const value = normalizeText(text);

  return (
    value.includes("new repo") ||
    value.includes("new repository") ||
    value.includes("repo banao") ||
    value.includes("repository banao") ||
    value.includes("create repo") ||
    value.includes("create repository")
  );
}

function wantsDeleteRepo(text: string) {
  const value = normalizeText(text);

  return (
    value.includes("delete repo") ||
    value.includes("delete repository") ||
    value.includes("repo delete") ||
    value.includes("repository delete")
  );
}

function wantsReadFile(text: string) {
  const value = normalizeText(text);

  return (
    value.includes("dao") ||
    value.includes("দাও") ||
    value.includes("show") ||
    value.includes("read") ||
    value.includes("dekhao") ||
    value.includes("দেখাও")
  );
}

function wantsWriteFile(text: string) {
  const value = normalizeText(text);

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

function wantsDeleteFile(text: string) {
  const value = normalizeText(text);

  return (
    value.includes("delete file") ||
    value.includes("remove file") ||
    value.includes("file delete") ||
    value.includes("file remove")
  );
}

function hasConfirmation(text: string) {
  const value = normalizeText(text);

  return (
    value.includes("confirm") ||
    value.includes("i confirm") ||
    value.includes("yes delete") ||
    value.includes("হ্যাঁ delete") ||
    value.includes("হ্যাঁ ডিলিট")
  );
}

function getOwnerFromEnv() {
  const owner =
    process.env.GITHUB_OWNER?.trim();

  return owner || null;
}

async function directGitHubAction(
  text: string
): Promise<{
  handled: boolean;
  message?: string;
  refreshRepos?: boolean;
}> {
  const owner = getOwnerFromEnv();

  /*
   * ---------------------------------------------------------
   * SIMPLE CHAT
   * ---------------------------------------------------------
   */

  if (isSimpleChat(text)) {
    return {
      handled: true,
      message:
        "Hello! 👋 I'm your GitHub AI Manager. I can manage repositories, files, branches, commits and pull requests."
    };
  }

  /*
   * ---------------------------------------------------------
   * LIST REPOSITORIES
   * ---------------------------------------------------------
   */

  if (wantsListRepos(text)) {
    const repos = await listRepos();

    if (!Array.isArray(repos) || repos.length === 0) {
      return {
        handled: true,
        message: "No GitHub repositories were found."
      };
    }

    const lines = repos.map((repo: any) => {
      const visibility =
        repo.private ? "private" : "public";

      return `• ${repo.name} (${visibility})`;
    });

    return {
      handled: true,
      message:
        `📁 Your repositories:\n\n${lines.join("\n")}`
    };
  }

  /*
   * ---------------------------------------------------------
   * CREATE REPOSITORY
   * ---------------------------------------------------------
   */

  if (wantsCreateRepo(text)) {
    const repoName =
      extractRepoName(text);

    if (!repoName) {
      return {
        handled: true,
        message:
          "Please provide the repository name. Example: `New repo banao example name diye`"
      };
    }

    const repo = await createRepo(
      repoName,
      "",
      false
    );

    return {
      handled: true,
      refreshRepos: true,
      message:
        `✅ Created public repository **${repo.name}** under your GitHub account.\n\n${repo.html_url || ""}`
    };
  }

  /*
   * ---------------------------------------------------------
   * REPOSITORY + FILE
   * ---------------------------------------------------------
   */

  const repoFile =
    extractRepoAndFile(text);

  if (repoFile && !owner) {
    return {
      handled: true,
      message:
        "GITHUB_OWNER is not configured. Add your GitHub username to the server environment."
    };
  }

  /*
   * ---------------------------------------------------------
   * FILE WRITE
   * ---------------------------------------------------------
   */

  if (
    repoFile &&
    wantsWriteFile(text)
  ) {
    const content =
      extractFileContent(text);

    if (!content) {
      return {
        handled: true,
        message:
          `I found **${repoFile.path}**, but I couldn't determine its content.\n\nExample:\n\`${repoFile.repo} repo te README.md add koro - hi this is a example repo\``
      };
    }

    /*
     * First get repository information.
     *
     * If the repository is completely empty, the normal
     * Contents API cannot create the first file. In that
     * situation we return a clear message instead of allowing
     * the generic 404 to leak into the chat.
     */
    const repository = await getRepo(
      owner!,
      repoFile.repo
    );

    if (
      !repository.default_branch &&
      repository.size === 0
    ) {
      return {
        handled: true,
        message:
          `⚠️ **${repoFile.repo}** is an empty repository.\n\nThe repository needs an initial commit before files can be added through the current GitHub API flow.`
      };
    }

    const result =
      await createOrUpdateFile(
        owner!,
        repoFile.repo,
        repoFile.path,
        content,
        `Add ${repoFile.path}`
      );

    return {
      handled: true,
      message:
        `✅ **${repoFile.path}** was added/updated in **${repoFile.repo}**.\n\nCommit: \`${result.commit?.sha || result.commit?.html_url || "created"}\``
    };
  }

  /*
   * ---------------------------------------------------------
   * FILE DELETE
   * ---------------------------------------------------------
   */

  if (
    repoFile &&
    wantsDeleteFile(text)
  ) {
    if (!hasConfirmation(text)) {
      return {
        handled: true,
        message:
          `⚠️ Deleting **${repoFile.path}** from **${repoFile.repo}** is a destructive action.\n\nIf you really want to delete it, reply with:\n\`CONFIRM DELETE FILE ${repoFile.path}\``
      };
    }

    const result =
      await deleteFile(
        owner!,
        repoFile.repo,
        repoFile.path,
        `Delete ${repoFile.path}`
      );

    return {
      handled: true,
      message:
        `🗑️ Deleted **${repoFile.path}** from **${repoFile.repo}**.\n\nCommit: \`${result.commit?.sha || "created"}\``
    };
  }

  /*
   * ---------------------------------------------------------
   * FILE READ
   * ---------------------------------------------------------
   */

  if (
    repoFile &&
    wantsReadFile(text)
  ) {
    const result =
      await findAndReadFile(
        owner!,
        repoFile.repo,
        repoFile.path
      );

    if (!result.found) {
      if (result.ambiguous) {
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
            `I found multiple files matching **${repoFile.path}**:\n\n${matches}\n\nPlease specify the exact path.`
        };
      }

      return {
        handled: true,
        message:
          `❌ I couldn't find **${repoFile.path}** in **${repoFile.repo}**.`
      };
    }

    return {
      handled: true,
      message:
        `📄 **${result.path}**\n\n\`\`\`\n${result.content || ""}\n\`\`\``
    };
  }

  /*
   * ---------------------------------------------------------
   * REPOSITORY DELETE
   * ---------------------------------------------------------
   */

  if (wantsDeleteRepo(text)) {
    const repoMatch =
      text.match(
        /(?:delete|remove)\s+(?:repo(?:sitory)?\s+)?["'`]?([A-Za-z0-9_.-]+)["'`]?/i
      );

    const repoName =
      repoMatch?.[1];

    if (!repoName) {
      return {
        handled: true,
        message:
          "Please specify which repository you want to delete."
      };
    }

    if (!hasConfirmation(text)) {
      return {
        handled: true,
        message:
          `⚠️ Deleting **${repoName}** permanently is a destructive action.\n\nIf you really want to delete it, reply with:\n\`CONFIRM DELETE REPOSITORY ${repoName}\``
      };
    }

    if (!owner) {
      return {
        handled: true,
        message:
          "GITHUB_OWNER is not configured."
      };
    }

    await deleteRepo(
      owner,
      repoName
    );

    return {
      handled: true,
      refreshRepos: true,
      message:
        `🗑️ Repository **${repoName}** was deleted successfully.`
    };
  }

  return {
    handled: false
  };
}

/*
 * -----------------------------------------------------------
 * GROQ TOOLS
 *
 * These are used only when the request genuinely needs AI
 * reasoning/generation.
 * -----------------------------------------------------------
 */

const aiTools = [
  {
    type: "function",
    function: {
      name: "get_repository",
      description:
        "Get information about a specific GitHub repository.",
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
        required: ["owner", "repo"],
        additionalProperties: false
      }
    }
  },

  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read an exact file when AI reasoning requires its content.",
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
      name: "create_or_update_file",
      description:
        "Create or update a GitHub file after AI has generated or fixed its content.",
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
  }
];

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

    case "create_or_update_file":
      return createOrUpdateFile(
        args.owner,
        args.repo,
        args.path,
        args.content,
        args.message,
        args.branch
      );

    default:
      throw new Error(
        `Unknown AI tool: ${name}`
      );
  }
}

/*
 * -----------------------------------------------------------
 * POST
 * -----------------------------------------------------------
 */

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const userMessages: ChatMessage[] =
      Array.isArray(body.messages)
        ? body.messages
        : [];

    if (
      userMessages.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "No messages provided."
        },
        {
          status: 400
        }
      );
    }

    const latestUser =
      getLatestUserMessage(
        userMessages
      );

    const userText =
      typeof latestUser?.content === "string"
        ? latestUser.content.trim()
        : "";

    if (!userText) {
      return NextResponse.json({
        message:
          "Please enter a message.",
        refreshRepos: false
      });
    }

    /*
     * FIRST:
     * Try deterministic/local GitHub handling.
     *
     * This is the important part that prevents "Hi?"
     * and simple GitHub operations from unnecessarily
     * entering the Groq tool loop.
     */
    const direct =
      await directGitHubAction(
        userText
      );

    if (direct.handled) {
      return NextResponse.json({
        message:
          direct.message || "Done.",
        refreshRepos:
          Boolean(direct.refreshRepos)
      });
    }

    /*
     * SECOND:
     * Only now use Groq for genuine reasoning tasks.
     */

    const systemMessage: ChatMessage = {
      role: "system",
      content: `
You are GitHub AI Manager.

Use AI reasoning only when the user asks for:
- explanation
- debugging
- fixing code
- generating code
- architecture
- complex GitHub planning
- analysis

Simple GitHub operations are handled by the server directly.

Rules:
- Never claim a GitHub action succeeded unless a tool actually succeeded.
- Preserve existing code unless the user asks to replace it.
- When modifying a file, prefer reading the existing file first.
- Generate complete valid file content when updating files.
- Do not invent repository names, paths, branches, commits or results.
- Be concise.

The configured GitHub owner may be available through the server environment.
`
    };

    const conversation:
      ChatMessage[] = [
        systemMessage,
        ...userMessages
      ];

    let refreshRepos =
      false;

    /*
     * Keep the AI loop small.
     * This prevents unnecessary Groq usage.
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

      const assistantMessage =
        response?.choices?.[0]?.message;

      if (!assistantMessage) {
        throw new Error(
          "Groq returned an empty response."
        );
      }

      conversation.push({
        role: "assistant",
        content:
          assistantMessage.content ||
          null,
        tool_calls:
          assistantMessage.tool_calls ||
          undefined
      });

      const toolCalls =
        assistantMessage.tool_calls ||
        [];

      if (
        toolCalls.length === 0
      ) {
        return NextResponse.json({
          message:
            assistantMessage.content ||
            "Done.",
          refreshRepos
        });
      }

      for (
        const toolCall of toolCalls
      ) {
        const toolName =
          toolCall?.function?.name;

        if (!toolName) {
          continue;
        }

        let args:
          Record<string, any> = {};

        try {
          args = JSON.parse(
            toolCall.function.arguments ||
              "{}"
          );
        } catch {
          throw new Error(
            `Invalid tool arguments returned for ${toolName}.`
          );
        }

        const result =
          await executeAiTool(
            toolName,
            args
          );

        conversation.push({
          role: "tool",
          tool_call_id:
            toolCall.id,
          name: toolName,
          content:
            JSON.stringify(result)
        });
      }
    }

    return NextResponse.json({
      message:
        "The AI reached the maximum reasoning steps. Please try the request again.",
      refreshRepos
    });
  } catch (error) {
    console.error(
      "GitHub AI Manager error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error."
      },
      {
        status: 500
      }
    );
  }
}
