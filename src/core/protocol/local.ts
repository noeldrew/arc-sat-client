import { z } from "zod";
import { CustomerSchema, JsonValueSchema, TriggerDefinitionSchema } from "./common";

export const LocalInboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), app: z.string(), version: z.string(), triggers: z.array(TriggerDefinitionSchema).optional() }),
  z.object({ type: z.literal("register-triggers"), triggers: z.array(TriggerDefinitionSchema) }),
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("trigger"), trigger_id: z.string().min(1), session_id: z.string().optional(), payload: z.record(JsonValueSchema).optional() }),
  z.object({ type: z.literal("session-started"), session_id: z.string().min(1) }),
  z.object({ type: z.literal("session-ended"), session_id: z.string().optional() }),
  z.object({ type: z.literal("close-session"), session_id: z.string().optional() }),
  z.object({ type: z.literal("ugc-upload") }).passthrough(),
  z.object({ type: z.literal("ack") }).passthrough(),
]);

export const LocalOutboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ack") }).passthrough(),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("session-start"), session_id: z.string().min(1), action: z.string().optional(), customer: CustomerSchema.optional(), payload: z.record(JsonValueSchema).optional() }).passthrough(),
  z.object({ type: z.literal("session-end"), session_id: z.string().optional() }),
  z.object({ type: z.literal("command"), action: z.string() }).passthrough(),
  z.object({ type: z.literal("content") }).passthrough(),
  z.object({ type: z.literal("error"), detail: z.string() }),
  z.object({ type: z.literal("ugc_confirmed") }).passthrough(),
  z.object({ type: z.literal("ugc_error") }).passthrough(),
]);

export type LocalInboundMessage = z.infer<typeof LocalInboundSchema>;
export type LocalOutboundMessage = z.infer<typeof LocalOutboundSchema>;
