import { ApifyClient } from "apify-client";
import { getApifyConfig } from "./config";

let client: ApifyClient | undefined;

export function getApifyClient(): ApifyClient {
  if (!client) {
    client = new ApifyClient({ token: getApifyConfig().token });
  }
  return client;
}

export { getApifyConfig };
