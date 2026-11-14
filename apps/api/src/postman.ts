// Generates a Postman v2.1 collection from the OpenAPI document, so both always describe the same API.

type OpenApi = { info: { title: string; version: string; description?: string }; paths: Record<string, Record<string, { summary?: string; tags?: string[]; "x-scope"?: string; parameters?: { $ref?: string; name?: string; in?: string }[]; requestBody?: { content?: Record<string, { example?: unknown; schema?: unknown }> } }>> };

export function openapiToPostman(spec: OpenApi, baseUrl: string) {
  const folders = new Map<string, unknown[]>();
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const tag = op.tags?.[0] ?? "General";
      const writes = method !== "get";
      const pmPath = path.replace(/^\//, "").split("/").map((seg) => seg.replace(/^\{(.+)\}$/, ":$1"));
      const query = (op.parameters ?? []).filter((p) => p.in === "query").map((p) => ({ key: p.name!, value: "", disabled: true }));
      const example = op.requestBody?.content?.["application/json"]?.example;
      folders.set(tag, [
        ...(folders.get(tag) ?? []),
        {
          name: `${method.toUpperCase()} ${path}${op.summary ? ` — ${op.summary.split(".")[0]}` : ""}`,
          request: {
            method: method.toUpperCase(),
            header: [
              ...(writes ? [{ key: "Idempotency-Key", value: "{{$guid}}", description: "Required for writes" }] : []),
              ...(op.requestBody?.content?.["application/json"] ? [{ key: "Content-Type", value: "application/json" }] : []),
            ],
            url: { raw: `{{baseUrl}}${path.replace(/\{(.+?)\}/g, ":$1")}`, host: ["{{baseUrl}}"], path: pmPath, query, variable: pmPath.filter((s) => s.startsWith(":")).map((s) => ({ key: s.slice(1), value: "" })) },
            ...(op.requestBody?.content?.["application/json"] ? { body: { mode: "raw", raw: JSON.stringify(example ?? {}, null, 2), options: { raw: { language: "json" } } } } : {}),
            description: op["x-scope"] ? `Scope: ${op["x-scope"]}` : undefined,
          },
        },
      ]);
    }
  }
  return {
    info: { name: spec.info.title, _postman_id: "sichttakt-public-api-v1", description: spec.info.description, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{apiKey}}", type: "string" }] },
    variable: [
      { key: "baseUrl", value: baseUrl },
      { key: "apiKey", value: "st_test_…" },
    ],
    item: [...folders.entries()].map(([name, item]) => ({ name, item })),
  };
}
