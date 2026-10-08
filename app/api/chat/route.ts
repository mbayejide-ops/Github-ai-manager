import { NextResponse } from "next/server";

import {
  runGitHubAgent
} from "@/lib/github-agent";

type ChatMessage = {
  role: "user" | "assistant";
  content?: string | null;
};

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const messages:
      ChatMessage[] =
      Array.isArray(body.messages)
        ? body.messages.filter(
            (message: any) =>
              message &&
              (
                message.role ===
                  "user" ||
                message.role ===
                  "assistant"
              )
          )
        : [];

    if (!messages.length) {
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

    const result =
      await runGitHubAgent(
        messages
      );

    return NextResponse.json(
      result
    );
  } catch (error) {
    console.error(
      "GitHub Agent error:",
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
