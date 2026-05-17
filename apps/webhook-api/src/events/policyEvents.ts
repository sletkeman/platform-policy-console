import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

export type PullRequestPolicyEvent =
  | {
      type: "pull_request_policy_requested";
      delivery: string;
      owner: string;
      repo: string;
      pullNumber: number;
      action: string;
      title: string;
      occurredAt: string;
    }
  | {
      type: "pull_request_policy_completed";
      delivery: string;
      owner: string;
      repo: string;
      pullNumber: number;
      passed: boolean;
      commentAction?: "created" | "updated";
      commentUrl?: string;
      occurredAt: string;
    }
  | {
      type: "pull_request_policy_failed";
      delivery: string;
      owner: string;
      repo: string;
      pullNumber: number;
      reason: string;
      occurredAt: string;
    };

export type PolicyEventPublisher = {
  publish(event: PullRequestPolicyEvent): Promise<void>;
};

export class NoopPolicyEventPublisher implements PolicyEventPublisher {
  publish(): Promise<void> {
    return Promise.resolve();
  }
}

export class SnsPolicyEventPublisher implements PolicyEventPublisher {
  private readonly sns: SNSClient;

  constructor(
    private readonly topicArn: string,
    region: string
  ) {
    this.sns = new SNSClient({ region });
  }

  async publish(event: PullRequestPolicyEvent) {
    await this.sns.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify(event),
        MessageAttributes: {
          event_type: {
            DataType: "String",
            StringValue: event.type
          },
          repository: {
            DataType: "String",
            StringValue: `${event.owner}/${event.repo}`
          }
        }
      })
    );
  }
}

export function createPolicyEventPublisher({
  topicArn,
  region
}: {
  topicArn?: string | undefined;
  region: string;
}) {
  return topicArn ? new SnsPolicyEventPublisher(topicArn, region) : new NoopPolicyEventPublisher();
}
