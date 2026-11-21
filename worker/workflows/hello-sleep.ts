import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  runHelloSleepWorkflow,
  type HelloSleepPayload,
  type HelloSleepResult,
} from "@/lib/workflows/hello-sleep-logic";

export class HelloSleepWorkflow extends WorkflowEntrypoint<Env, HelloSleepPayload> {
  async run(
    event: WorkflowEvent<HelloSleepPayload>,
    step: WorkflowStep
  ): Promise<HelloSleepResult> {
    return runHelloSleepWorkflow(event.payload, {
      recordStart: (fn) => step.do("record-start", fn),
      sleep: (duration) => step.sleep("wait-durable-interval", duration),
      recordResume: (fn) => step.do("record-resume", fn),
    });
  }
}
