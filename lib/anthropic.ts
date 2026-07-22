import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicConfig } from "./config";

let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getAnthropicConfig().apiKey });
  }
  return client;
}

export { getAnthropicConfig };
