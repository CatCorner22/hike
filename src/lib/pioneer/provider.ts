import { createGateway } from "@ai-sdk/gateway";
import { openai } from "@ai-sdk/openai";
import { getPioneerConfig } from "./config";

let gateway: ReturnType<typeof createGateway> | null = null;

function getGateway(apiKey: string) {
  if (!gateway) {
    gateway = createGateway({ apiKey });
  }
  return gateway;
}

export function resolvePioneerModelId(
  env: Record<string, string | undefined> = process.env,
): string {
  const id = getPioneerConfig(env).model;
  return id.includes("/") ? id : `openai/${id}`;
}

/** Spirit-style gateway first; hike research's OpenAI provider as fallback. */
export function pioneerModel(env: Record<string, string | undefined> = process.env) {
  const id = resolvePioneerModelId(env);
  const gatewayKey = env.AI_GATEWAY_API_KEY?.trim();
  if (gatewayKey) {
    return getGateway(gatewayKey)(id);
  }
  const openaiId = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  return openai(openaiId);
}
