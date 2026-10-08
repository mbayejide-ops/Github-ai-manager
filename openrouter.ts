export async function openRouter(body: any) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");
  if (!process.env.OPENROUTER_MODEL) throw new Error("OPENROUTER_MODEL is not configured.");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://vercel.com",
      "X-Title": "GitHub AI Manager"
    },
    body: JSON.stringify({ ...body, model: process.env.OPENROUTER_MODEL })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `OpenRouter error ${res.status}`);
  return data;
}
