import { NextResponse } from "next/server";
import { listRepos } from "@/lib/github";

export async function GET() {
  try {
    const repositories = await listRepos();

    return NextResponse.json({
      repositories
    });
  } catch (error) {
    console.error("GitHub repository error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch repositories"
      },
      {
        status: 500
      }
    );
  }
}
