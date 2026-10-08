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

import { groqChat } from "@/lib/groq";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

const tools = [
  {
    type: "function",
    function: {
      name: "list_repositories",
      description:
        "List all GitHub repositories accessible by the configured GitHub token.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },

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
            type: "string",
            description: "GitHub username or organization"
          },
          repo: {
            type: "string",
            description: "Repository name"
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
        "Read the contents of a file from a GitHub repository.",
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
            type: "string",
            description: "Path of the file"
          },
          ref: {
            type: "string",
            description:
              "Optional branch, tag, or commit SHA"
          }
        },
        required: ["owner", "repo", "path"],
        additionalProperties: false
      }
    }
  },

  {
    type: "function",
    function: {
      name: "create_or_update_file",
      description:
        "Create a new file or update an existing file in a GitHub repository and commit the change.",
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
            type: "string",
            description: "Git commit message"
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
      name: "delete_file",
      description:
        "Delete a file from a GitHub repository and create a commit.",
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
          "message"
        ],
        additionalProperties: false
      }
    }
  },

  {
    type: "function",
    function: {
      name: "create_repository",
      description:
        "Create a new GitHub repository.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string"
          },
          description: {
            type: "string"
          },
          isPrivate: {
            type: "boolean"
          }
        },
        required: ["name"],
        additionalProperties: false
      }
    }
  },

  {
    type: "function",
    function: {
      name: "create_branch",
      description:
        "Create a new branch from an existing branch.",
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
  },

  {
    type: "function",
    function: {
      name: "merge_pull_request",
      description:
        "Merge an existing GitHub pull request.",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string"
          },
          repo: {
            type: "string"
          },
          number: {
            type: "number"
          }
        },
        required: ["owner", "repo", "number"],
        additionalProperties: false
      }
    }
  },

  {
    type: "function",
    function: {
      name: "delete_repository",
      description:
        "Delete an entire GitHub repository.",
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
  }
];

const destructiveTools = new Set([
  "delete_repository",
  "delete_file",
  "merge_pull_request"
]);

function hasConfirmation(messages: ChatMessage[]) {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  const text =
    typeof latestUserMessage?.content === "string"
      ? latestUserMessage.content.toUpperCase()
      : "";

  return (
    text.includes("CONFIRM") ||
    text.includes("DELETE REPOSITORY")
  );
}

async function executeTool(
  name: string,
  args: Record<string, any>,
  messages: ChatMessage[]
) {
  if (
    destructiveTools.has(name) &&
    !hasConfirmation(messages)
  ) {
    return {
      confirmation_required: true,
      message:
        "This is a destructive action. Explicit user confirmation is required before executing it."
    };
  }

  switch (name) {
    case "list_repositories":
      return await listRepos();

    case "get_repository":
      return await getRepo(
        args.owner,
        args.repo
      );

    case "read_file":
      return await readFile(
        args.owner,
        args.repo,
        args.path,
        args.ref
      );

    case "create_or_update_file":
      return await createOrUpdateFile(
        args.owner,
        args.repo,
        args.path,
        args.content,
        args.message,
        args.branch
      );

    case "delete_file":
      return await deleteFile(
        args.owner,
        args.repo,
        args.path,
        args.message,
        args.branch
      );

    case "create_repository":
      return await createRepo(
        args.name,
        args.description || "",
        Boolean(args.isPrivate)
      );

    case "create_branch":
      return await createBranch(
        args.owner,
        args.repo,
        args.branch,
        args.from
      );

    case "create_pull_request":
      return await createPullRequest(
        args.owner,
        args.repo,
        args.title,
        args.head,
        args.base,
        args.body || ""
      );

    case "merge_pull_request":
      return await mergePullRequest(
        args.owner,
        args.repo,
        Number(args.number)
      );

    case "delete_repository":
      return await deleteRepo(
        args.owner,
        args.repo
      );

    default:
      throw new Error(
        `Unknown tool: ${name}`
      );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const userMessages: ChatMessage[] =
      Array.isArray(body.messages)
        ? body.messages
        : [];

    if (userMessages.length === 0) {
      return NextResponse.json(
        {
          error: "No messages provided."
        },
        {
          status: 400
        }
      );
    }

    const systemMessage: ChatMessage = {
      role: "system",
      content: `
You are GitHub AI Manager.

You control GitHub through the provided tools.

Your responsibilities:
- Understand natural-language GitHub requests.
- Use the appropriate GitHub tool when an actual action is requested.
- Never claim an action succeeded unless the tool actually succeeded.
- Read existing files before modifying them when necessary.
- Preserve existing code unless the user specifically asks to replace it.
- When creating or updating files, produce complete valid file content.
- Keep the final response concise and clearly state what happened.
- If a repository is selected by the UI, prefer that repository when appropriate.

Safety rules:
- Never delete a repository without explicit confirmation.
- Never delete a file without explicit confirmation.
- Never merge a pull request without explicit confirmation.
- If confirmation is required, clearly tell the user what action needs confirmation.
`
    };

    const conversation: ChatMessage[] = [
      systemMessage,
      ...userMessages
    ];

    let refreshRepos = false;

    /*
     * Agent/tool loop.
     *
     * The model can:
     * 1. Ask for a tool
     * 2. Our server executes the tool
     * 3. Tool result goes back to Groq
     * 4. Groq can request another tool
     * 5. Eventually Groq returns the final answer
     */
    for (let step = 0; step < 8; step++) {
      const response = await groqChat(
        conversation,
        tools
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
          assistantMessage.content || null,
        tool_calls:
          assistantMessage.tool_calls || undefined
      });

      const toolCalls =
        assistantMessage.tool_calls || [];

      if (toolCalls.length === 0) {
        return NextResponse.json({
          message:
            assistantMessage.content ||
            "Done.",
          refreshRepos
        });
      }

      for (const toolCall of toolCalls) {
        const toolName =
          toolCall?.function?.name;

        if (!toolName) {
          continue;
        }

        let args: Record<string, any> = {};

        try {
          args = JSON.parse(
            toolCall.function.arguments || "{}"
          );
        } catch {
          throw new Error(
            `Invalid tool arguments returned for ${toolName}.`
          );
        }

        const result =
          await executeTool(
            toolName,
            args,
            userMessages
          );

        if (
          toolName === "create_repository" ||
          toolName === "delete_repository"
        ) {
          refreshRepos = true;
        }

        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify(result)
        });
      }
    }

    return NextResponse.json({
      message:
        "The AI reached the maximum number of tool operations. Please check the GitHub repository state and continue if needed.",
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
