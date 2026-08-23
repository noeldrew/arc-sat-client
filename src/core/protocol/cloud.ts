import { z } from "zod";
import { CustomerSchema, JsonValueSchema, TriggerDefinitionSchema } from "./common";

export const CloudConnectSchema = z.object({
  type: z.literal("connect"),
  client_id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  triggers: z.array(TriggerDefinitionSchema),
  api_token: z.string().min(1).optional(),
  installation_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional(),
  description: z.string().optional(),
  zone: z.string().optional(),
  application_type: z.string().optional(),
});

export const CloudOutboundSchema = z.discriminatedUnion("type", [
  CloudConnectSchema,
  z.object({ type: z.literal("pong"), client_id: z.string().min(1).optional() }),
  z.object({
    type: z.literal("trigger"),
    client_id: z.string().min(1),
    trigger_id: z.string().min(1),
    session_id: z.string().nullish(),
    payload: z.record(JsonValueSchema),
  }),
  z.object({ type: z.literal("triggers-update"), client_id: z.string().min(1), triggers: z.array(TriggerDefinitionSchema) }),
  z.object({ type: z.literal("triggers-report"), client_id: z.string().min(1), triggers: z.array(TriggerDefinitionSchema) }),
  z.object({ type: z.literal("session-started"), client_id: z.string().min(1), session_id: z.string().min(1), customer_id: z.string().optional() }),
  z.object({ type: z.literal("session-ended"), client_id: z.string().min(1), session_id: z.string().min(1), customer_id: z.string().optional() }),
  z.object({ type: z.literal("health_status"), client_id: z.string().min(1), alert: z.boolean(), reasons: z.array(z.string()) }),
  z.object({ type: z.literal("system_alert"), client_id: z.string().min(1), process: z.string(), status: z.enum(["running", "stopped"]), timestamp: z.string() }),
  z.object({ type: z.literal("snapshot-response"), client_id: z.string().min(1), stats: z.record(JsonValueSchema) }),
]);

const CloudAckSchema = z.object({
  type: z.literal("ack"),
  ref: z.string(),
  api_token: z.string().optional(),
  canonical_client_id: z.string().optional(),
  session_id: z.string().optional(),
}).passthrough();

export const CloudCommandSchema = z.object({
  type: z.literal("command"),
  action: z.string(),
  session_id: z.string().optional(),
  customer_id: z.string().optional(),
  customer: CustomerSchema.optional(),
  payload: z.record(JsonValueSchema).optional(),
}).passthrough();

export const CloudInboundSchema = z.discriminatedUnion("type", [
  CloudAckSchema,
  CloudCommandSchema,
  z.object({ type: z.literal("session_start"), session_id: z.string().min(1), customer: CustomerSchema.optional(), payload: z.record(JsonValueSchema).optional() }).passthrough(),
  z.object({ type: z.literal("ping") }).passthrough(),
  z.object({ type: z.literal("error"), detail: z.string().optional() }).passthrough(),
]);

export type CloudOutboundMessage = z.infer<typeof CloudOutboundSchema>;
export type CloudInboundMessage = z.infer<typeof CloudInboundSchema>;
