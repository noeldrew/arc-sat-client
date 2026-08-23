import { z } from "zod";

export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(JsonValueSchema)]),
);

export const TriggerDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(""),
}).passthrough();

export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>;

export const CustomerSchema = z.object({ id: z.string().min(1) }).passthrough();
export type Customer = z.infer<typeof CustomerSchema>;
