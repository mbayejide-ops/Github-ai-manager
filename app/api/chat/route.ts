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
import { openRouterChat } from "@/lib/openrouter";

type ChatMessage = {
  role: "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: any[];
  tool_call_id?: string;
};

const tools = [
  {
    type: "function",
    function: {
      name: "list_repositories",
      description: "List repositories accessible by the configured GitHub token.",
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
      description: "Get details about a GitHub repository.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" }
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
      description: "Read a file from a GitHub repository.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string" },
          ref: { type: "string" }
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
        "Create a new file or replace an existing file and commit the change.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string" },
          content: { type: "string" },
          message: { type: "string" },
          branch: { type: "string" }
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
      description: "Delete a file from a repository.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string" },
          message: { type: "string" },
          branch: { type: "string" }
        },
        required: ["owner", "repo", "path", "message"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_repository",
      description: "Create a new GitHub repository.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          isPrivate: { type: "boolean" }
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
      description: "Create a new branch from another branch.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          branch: { type: "string" },
          from: { type: "string" }
        },
        required: ["owner", "repo", "branch", "from"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_pull_request",
      description: "Create a pull request.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          title: { type: "string" },
          head: { type: "string" },
          base: { type: "string" },
          body: { type: "string" }
        },
        required: ["owner", "repo", "title", "head", "base"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "merge_pull_request",
      description: "Merge a pull request.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          number: { type: "number" }
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
      description: "Delete an entire GitHub repository.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" }
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

  const text = latestUserMessage?.content?.toUpperCase() || "";

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
  if (destructiveTools.has(name) && !hasConfirmation(messages)) {
    return {
      confirmation_required: true,
      message:
        "This is a destructive action. Ask the user to explicitly confirm before executing it."
    };
  }

  switch (name) {
    case "list_repositories":
      return await listRepos();

    case "get_repository":
      return await getRepo(args.owner, args.repo);

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
      return await deleteRepo(args.owner, args.repo);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const userMessages: ChatMessage[] = body.messages || [];

    const systemMessage: ChatMessage = {
      role: "system" as any,
      content: `
You are GitHub AI Manager.

You manage GitHub repositories through tools.

Rules:
- Understand the user's natural-language request.
- Use tools when an actual GitHub action is required.
- Never pretend an action succeeded if the tool did not succeed.
- Before editing a file, read it when necessary to avoid accidentally destroying existing content.
- Keep responses concise but explain what was done.
- If the user selected a repository in the UI, prefer that repository when appropriate.
- For destructive operations, the server requires explicit confirmation.
`
    };

    const conversation: ChatMessage[] = [
      systemMessage,
      ...userMessages
    ];

    let refreshRepos = false;

    for (let step = 0; step < 6; step++) {
      const response = await openRouterChat(
        conversation,
        tools
      );

      const assistantMessage = response.choices?.[0]?.message;

      if (!assistantMessage) {
        throw new Error("OpenRouter returned no message.");
      }

      conversation.push(assistantMessage);

      const toolCalls = assistantMessage.tool_calls || [];

      if (toolCalls.length === 0) {
        return NextResponse.json({
          message: assistantMessage.content || "Done.",
          refreshRepos
        });
      }

      for (const toolCall of toolCalls) {
        const name = toolCall.function.name;

        let args: Record<string, any> = {};

        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          args = {};
        }

        const result = await executeTool(
          name,
          args,
          userMessages
        );

        if (
          name === "create_repository" ||
          name === "delete_repository"
        ) {
          refreshRepos = true;
        }

        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
    }

    return NextResponse.json({
      message:
        "The operation reached the maximum tool steps. Please check the repository state before continuing.",
      refreshRepos
    });
  } catch (error) {
    console.error("Chat API error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error"
      },
      {
        status: 500
      }
    );
  }
}
