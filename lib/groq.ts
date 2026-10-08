const GROQ_API_URL =
  "https://api.groq.com/openai/v1/chat/completions";

export async function groqChat(
  messages: any[],
  tools: any[] = []
) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is missing.");
  }

  if (!model) {
    throw new Error("GROQ_MODEL is missing.");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Groq API error (${response.status}): ${errorText}`
    );
  }

  return response.json();
}
