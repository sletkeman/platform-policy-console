import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type { AppConfig } from "../config.js";

export function createDynamoDocumentClient(config: AppConfig) {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.AWS_REGION }));
}
