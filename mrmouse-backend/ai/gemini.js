// ai/gemini.js
// Gemini REST provider for the Free AI tier.
//
// Gemini 3 function calling requires:
// 1) preserving the full model response content, including thoughtSignature
// 2) returning the exact function-call id in every FunctionResponse
//
// This file handles the API transport and leaves accounting logic in agent.js/tools.js.

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

function cleanSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return { type: "OBJECT", properties: {} };
  }

  const out = {
    type: String(schema.type || "object").toUpperCase(),
  };

  if (typeof schema.description === "string" && schema.description.trim()) {
    out.description = schema.description;
  }

  if (Array.isArray(schema.enum)) {
    out.enum = schema.enum;
  }

  if (schema.properties && typeof schema.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        cleanSchema(value),
      ])
    );
  }

  if (Array.isArray(schema.required) && schema.required.length > 0) {
    out.required = schema.required;
  }

  if (schema.items && typeof schema.items === "object") {
    out.items = cleanSchema(schema.items);
  }

  return out;
}

function toFunctionDeclarations(tools) {
  return (Array.isArray(tools) ? tools : []).map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    parameters: cleanSchema(tool.input_schema),
  }));
}

function geminiError(message, code, extra = {}) {
  return Object.assign(new Error(message), {
    code,
    provider: "gemini",
    ...extra,
  });
}

function classifyGeminiError(status, apiMessage, model) {
  const msg = String(apiMessage || "").toLowerCase();

  if (status === 400) {
    return geminiError(
      "Gemini rejected the tool/conversation request.",
      "GEMINI_BAD_REQUEST",
      { status, model, apiMessage }
    );
  }

  if (status === 401 || status === 403) {
    return geminiError(
      "Gemini API authentication/access failed.",
      "GEMINI_AUTH",
      { status, model, apiMessage }
    );
  }

  if (status === 404) {
    return geminiError(
      `Gemini model "${model}" was not found or is unavailable to this API key.`,
      "GEMINI_MODEL_NOT_FOUND",
      { status, model, apiMessage }
    );
  }

  if (status === 429) {
    return geminiError(
      "The free AI is temporarily at its request limit. Please try again later.",
      "GEMINI_RATE_LIMIT",
      { status, model, apiMessage }
    );
  }

  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes("temporarily unavailable") ||
    msg.includes("high demand") ||
    msg.includes("overloaded")
  ) {
    return geminiError(
      "Gemini is temporarily unavailable. Please try again shortly.",
      "GEMINI_TEMPORARY",
      { status, model, apiMessage }
    );
  }

  return geminiError(
    "The free AI could not complete that request.",
    "GEMINI_ERROR",
    { status, model, apiMessage }
  );
}

function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Retried automatically by generateGemini() below: network failures, 429s,
// and the 5xx/"high demand" bucket are transient by nature. Everything else
// (bad request, auth, model not found) is retried zero times — retrying a
// malformed request just gets the same 400 back three times slower.
const RETRYABLE_CODES = new Set([
  "GEMINI_NETWORK",
  "GEMINI_TEMPORARY",
  "GEMINI_RATE_LIMIT",
]);

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

async function generateGemini(params) {
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
        `[gemini] ${err.code} on attempt ${attempt}/${MAX_ATTEMPTS} — retrying in ${Math.round(delay)}ms`,
        { model: params.model || process.env.GEMINI_MODEL, apiMessage: err.apiMessage }
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
  model = process.env.GEMINI_MODEL || "gemini-3.6-flash",
  maxOutputTokens = 1000,
}) {
  if (!isGeminiConfigured()) {
    throw geminiError(
      "Free Gemini AI is not configured on the server.",
      "GEMINI_NOT_CONFIGURED",
      { model }
    );
  }

  const functionDeclarations = toFunctionDeclarations(tools);

  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      maxOutputTokens,
    },
  };

  if (functionDeclarations.length) {
    body.tools = [{ functionDeclarations }];
  }

  const url =
    `${GEMINI_API_URL}/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[gemini] network error", err);
    throw geminiError(
      "Couldn't reach the free AI service.",
      "GEMINI_NETWORK",
      { model, cause: err }
    );
  }

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const apiMessage =
      data?.error?.message ||
      data?.error?.status ||
      raw ||
      `HTTP ${response.status}`;

    // This is server-side only. Never send the API key to the client.
    console.error("[gemini] Google API error", {
      status: response.status,
      model,
      message: apiMessage,
    });

    throw classifyGeminiError(response.status, apiMessage, model);
  }

  const candidate = data?.candidates?.[0];

  if (!candidate?.content) {
    console.error("[gemini] empty/blocked response", {
      model,
      finishReason: candidate?.finishReason,
      promptFeedback: data?.promptFeedback,
    });

    throw geminiError(
      "Gemini returned no usable response.",
      "GEMINI_EMPTY",
      {
        model,
        finishReason: candidate?.finishReason,
        promptFeedback: data?.promptFeedback,
      }
    );
  }

  const parts = Array.isArray(candidate.content.parts)
    ? candidate.content.parts
    : [];

  const functionCalls = parts
    .filter((part) => part?.functionCall?.name)
    .map((part) => ({
      id: part.functionCall.id || null,
      name: part.functionCall.name,
      input:
        part.functionCall.args &&
        typeof part.functionCall.args === "object"
          ? part.functionCall.args
          : {},
    }));

  // IMPORTANT:
  // Return the entire content object unchanged so agent.js can append it
  // exactly as Gemini returned it, preserving thoughtSignature fields.
  return {
    content: candidate.content,
    parts,
    functionCalls,
    finishReason: candidate.finishReason || null,
    usageMetadata: data?.usageMetadata || null,
    modelVersion: data?.modelVersion || model,
    responseId: data?.responseId || null,
  };
}

module.exports = {
  isGeminiConfigured,
  generateGemini,
};
