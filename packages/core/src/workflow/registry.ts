import type { StepDefinition, Workflow } from "./types.js";

/** workflow + step 注册表（架构 §5.5）：补偿阶段靠 stepId 反查 step。 */
export class WorkflowRegistry {
  private readonly workflows = new Map<string, Workflow<any, any>>();
  private readonly steps = new Map<string, StepDefinition<any, any, any>>();

  registerWorkflow(workflow: Workflow<any, any>): void {
    if (this.workflows.has(workflow.id)) {
      throw new Error(`Duplicate workflow: ${workflow.id}`);
    }
    this.workflows.set(workflow.id, workflow);
  }

  registerStep(step: StepDefinition<any, any, any>): void {
    if (this.steps.has(step.id)) {
      throw new Error(`Duplicate step: ${step.id}`);
    }
    this.steps.set(step.id, step);
  }

  getWorkflow(id: string): Workflow<any, any> | undefined {
    return this.workflows.get(id);
  }

  getStep(id: string): StepDefinition<any, any, any> | undefined {
    return this.steps.get(id);
  }

  workflowIds(): string[] {
    return [...this.workflows.keys()];
  }

  stepIds(): string[] {
    return [...this.steps.keys()];
  }
}
