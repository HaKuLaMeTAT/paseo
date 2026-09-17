import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { addModelVisibleStructuredContent } from "./tools/paseo-tool-serialization.js";
import { createPaseoToolCatalog, type PaseoToolHostDependencies } from "./tools/paseo-tools.js";
import type { PaseoToolResult } from "./tools/types.js";

export type AgentMcpServerOptions = PaseoToolHostDependencies;

type McpToolContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

function toMcpToolResult(result: PaseoToolResult, textOnly = false): CallToolResult {
  const modelVisibleResult = addModelVisibleStructuredContent(result);
  return {
    content: modelVisibleResult.content as CallToolResult["content"],
    ...(!textOnly && modelVisibleResult.structuredContent !== undefined
      ? {
          structuredContent:
            modelVisibleResult.structuredContent as CallToolResult["structuredContent"],
        }
      : {}),
    ...(modelVisibleResult.isError !== undefined ? { isError: modelVisibleResult.isError } : {}),
  };
}

export async function createAgentMcpServer(options: AgentMcpServerOptions): Promise<McpServer> {
  const catalog = await createPaseoToolCatalog(options);
  const server = new McpServer({
    name: "agent-mcp",
    version: "2.0.0",
  });

  for (const tool of catalog.tools.values()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: z
          .object({
            ...(tool.inputSchema instanceof z.ZodType
              ? (tool.inputSchema as z.ZodObject).shape
              : tool.inputSchema),
            resultFormat: z
              .enum(["both", "text"])
              .optional()
              .describe(
                "Use text to return one model-visible representation without duplicating the structured payload.",
              ),
          })
          .passthrough(),
      },
      async (args: unknown, context?: McpToolContext) => {
        const { resultFormat, ...input } = args as Record<string, unknown>;
        return toMcpToolResult(
          await catalog.executeTool(tool.name, input, { signal: context?.signal }),
          resultFormat === "text" || (tool.name === "read_context_file" && resultFormat !== "both"),
        );
      },
    );
  }

  return server;
}
