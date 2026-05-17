import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_TOKEN: optionalNonEmptyString(),
  AWS_REGION: z.string().min(1).default("us-east-1"),
  POLICY_EVENTS_TOPIC_ARN: optionalNonEmptyString()
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env) {
  return configSchema.parse(env);
}

function optionalNonEmptyString() {
  return z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());
}
