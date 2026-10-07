import { GoogleGenAI } from "@google/genai";
import { getGeminiConfig } from "./config";

let client: GoogleGenAI | undefined;

export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({
      apiKey: getGeminiConfig().apiKey,
      // Rate limits (429s) are retried with backoff instead of failing the whole analysis.
      httpOptions: { retryOptions: { attempts: 6, initialDelay: 2, maxDelay: 60 } },
    });
  }
  return client;
}

// Gemini's output budget includes its thinking tokens, which can run to tens of
// thousands on a 40-post classification batch, so this is the model's maximum.
// Only tokens actually generated are billed.
const MAX_OUTPUT_TOKENS = 65536;

/**
 * One request whose answer must match `schema` (a JSON Schema object), parsed
 * and returned. Throws on a truncated or empty response so the worker marks the
 * analysis failed instead of saving an empty report.
 */
export async function generateStructured<T>(system: string, schema: object, userContent: string, label: string): Promise<T> {
  const { model } = getGeminiConfig();
  const response = await getGeminiClient().models.generateContent({
    model,
    contents: userContent,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });

  const finish = response.candidates?.[0]?.finishReason ?? "NONE";
  if (finish === "MAX_TOKENS") throw new Error(`${label}: Gemini response was cut off (hit the output limit)`);
  const text = response.text;
  if (!text) throw new Error(`${label}: empty response from ${model} (finish reason ${finish})`);
  return JSON.parse(text) as T;
}

export { getGeminiConfig };
