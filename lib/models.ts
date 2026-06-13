import { Endpoint, LlamaModel, ResolvedModel, Settings } from "./types";
import { listModels } from "./llama";
import { modelKey, parseModelKey } from "./types";

/**
 * Fetches models from every configured endpoint and flattens them into a
 * single list of ResolvedModel, tagged with their endpoint. Endpoints that
 * are unreachable contribute an error rather than failing the whole load.
 */
export interface EndpointLoad {
  endpoint: Endpoint;
  models: LlamaModel[];
  error?: string;
}

export async function loadAllModels(
  endpoints: Endpoint[]
): Promise<EndpointLoad[]> {
  return Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        const models = await listModels(endpoint.url);
        return { endpoint, models };
      } catch (e) {
        return { endpoint, models: [], error: (e as Error).message };
      }
    })
  );
}

/** Flattens endpoint loads into resolved models, dropping disabled ones. */
export function resolveEnabledModels(
  loads: EndpointLoad[],
  disabled: string[]
): ResolvedModel[] {
  const disabledSet = new Set(disabled);
  const out: ResolvedModel[] = [];
  for (const load of loads) {
    for (const m of load.models) {
      const key = modelKey(load.endpoint.id, m.id);
      if (disabledSet.has(key)) continue;
      out.push({
        key,
        endpointId: load.endpoint.id,
        endpointName: load.endpoint.name,
        modelId: m.id,
        contextLength: m.contextLength,
        ownedBy: m.ownedBy,
      });
    }
  }
  return out;
}

/** Resolves a model key to the endpoint URL + model id needed for a request. */
export function resolveModelKey(
  key: string | undefined,
  settings: Settings
): { url: string; modelId: string; endpointName: string } | null {
  if (!key) return null;
  const ref = parseModelKey(key);
  if (!ref) return null;
  const endpoint = settings.endpoints.find((e) => e.id === ref.endpointId);
  if (!endpoint) return null;
  return {
    url: endpoint.url,
    modelId: ref.modelId,
    endpointName: endpoint.name,
  };
}

/** Friendly display for a model key: "model · endpoint", endpoint dropped if only one. */
export function describeModelKey(
  key: string | undefined,
  settings: Settings
): string {
  if (!key) return "no model";
  const ref = parseModelKey(key);
  if (!ref) return key;
  const endpoint = settings.endpoints.find((e) => e.id === ref.endpointId);
  if (!endpoint) return ref.modelId;
  if (settings.endpoints.length <= 1) return ref.modelId;
  return `${ref.modelId} · ${endpoint.name}`;
}
