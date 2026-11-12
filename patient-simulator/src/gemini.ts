// ── Gemini API client with streaming ───────────────────
// Calls Google Gemini API directly via fetch and streams
// the response as Server-Sent Events to the client.

interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

export interface GeminiMessage {
  role: "student" | "patient";
  content: string;
}

/** Convert stored messages into Gemini contents format. */
function toGeminiContents(messages: GeminiMessage[]): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role === "student" ? ("user" as const) : ("model" as const),
    parts: [{ text: m.content }],
  }));
}

/**
 * Call Gemini streaming endpoint and pipe text chunks via onChunk.
 * Returns the full accumulated text so the caller can persist it.
 */
export async function streamGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: GeminiMessage[],
  onChunk: (text: string) => void,
): Promise<string> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    model +
    ":streamGenerateContent?alt=sse&key=" +
    apiKey;

  const body = {
    contents: toGeminiContents(messages),
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
      topP: 0.95,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error("Gemini API error (" + response.status + "): " + errorText);
  }

  if (!response.body) {
    throw new Error("Gemini API returned no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          fullText += text;
          onChunk(text);
        }
      } catch {
        // Partial JSON — skip, will be completed on next chunk
      }
    }
  }

  return fullText;
}
