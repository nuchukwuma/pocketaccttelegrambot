// Gemini provider for the free AI tier.
// Uses the official Gemini REST generateContent API so no browser-side API key
// is ever exposed and the backend needs no extra SDK dependency.
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== "object") return { type: "OBJECT", properties: {} };
  const out = { ...schema };
  if (out.type) out.type = String(out.type).toUpperCase();
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([key, value]) => [key, toGeminiSchema(value)])
    );
  }
  if (out.items) out.items = toGeminiSchema(out.items);
  return out;
}

function toFunctionDeclarations(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.input_schema),
  }));
}

function publicGeminiError(err, model) {
  const status = err?.status;
  if (status === 429) {
    return Object.assign(
      new Error(
        "The free AI is temporarily at its request limit. Your data is still safe — try again later, or upgrade to Premium AI for higher availability."
      ),
      { code: "GEMINI_RATE_LIMIT", provider: "gemini", model }
    );
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return Object.assign(
      new Error("Gemini is temporarily busy. Please try again shortly."),
      { code: "GEMINI_TEMPORARY", provider: "gemini", model }
    );
  }
  return Object.assign(
    new Error("The free AI couldn't complete that request right now. Please try again."),
    { code: "GEMINI_ERROR", provider: "gemini", model }
  );
}

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Retried automatically by generateGemini() below: network failures, 429s,
// and the 5xx/"high demand" bucket are transient by nature. Everything else
// is retried zero times — retrying a malformed request just gets the same
// error back three times slower.
const RETRYABLE_CODES = new Set(["GEMINI_NETWORK", "GEMINI_TEMPORARY", "GEMINI_RATE_LIMIT"]);

const MAX_ATTEMPTS = 3; // 1 initial try + 2 retries
const BASE_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  // attempt is 1-indexed (the retry number, not the total call count).
  const exp = BASE_DELAY_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * BASE_DELAY_MS;
  return exp + jitter;
}

export async function generateGemini(params) {
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptGemini(params);
    } catch (err) {
      lastErr = err;

      const retryable = RETRYABLE_CODES.has(err?.code);
      const attemptsLeft = attempt < MAX_ATTEMPTS;

      if (!retryable || !attemptsLeft) throw err;

      const delay = backoffDelay(attempt);
      console.error(
        `[gemini] ${err.code} on attempt ${attempt}/${MAX_ATTEMPTS} — retrying in ${Math.round(delay)}ms`
      );
      await sleep(delay);
    }
  }

  // Unreachable in practice (the loop always returns or throws above), but
  // keeps this function's return type honest for any future refactor.
  throw lastErr;
}

async function attemptGemini({
  contents,
  systemPrompt,
  tools,
  model = process.env.GEMINI_MODEL || "gemini-2.5-flash",
  maxOutputTokens = 1000,
}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Free AI is not configured on the server yet.");
  }

  const url = `${GEMINI_API_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    tools: [{ functionDeclarations: toFunctionDeclarations(tools) }],
    generationConfig: {
      maxOutputTokens,
    },
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw Object.assign(
      new Error("Couldn't reach the free AI service. Please try again shortly."),
      { code: "GEMINI_NETWORK", cause: err }
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiError = new Error(data?.error?.message || `Gemini request failed: ${response.status}`);
    apiError.status = response.status;
    throw publicGeminiError(apiError, model);
  }

  const candidate = data?.candidates?.[0];
  if (!candidate?.content) {
    throw Object.assign(new Error("Gemini returned no usable response."), {
      code: "GEMINI_EMPTY",
      provider: "gemini",
      model,
    });
  }

  return {
    content: candidate.content,
    parts: candidate.content.parts || [],
    functionCalls: (candidate.content.parts || [])
      .filter((part) => part.functionCall?.name)
      .map((part) => ({
        id: part.functionCall.id || null,
        name: part.functionCall.name,
        input: part.functionCall.args || {},
      })),
  };
}
