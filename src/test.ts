// import {
//   createStepPlan,
//   type StepPlan,
// } from "./services/ai/stepbystep/createStepPlan";
// import agentResponse from "./test-agent-response.txt?raw";

// const userMessage = "میخوام این رو قدم به قدم باهم انجام بدیم";

export async function runTest(): Promise<void> {
  // let plan: StepPlan;

  // try {
  //   plan = await createStepPlan({
  //     userMessage,
  //     agentResponse,
  //   });
  // } catch (error) {
  //   console.error("[createStepPlan test] Failed:", error);

  //   return;
  // }

  // console.log("[createStepPlan test] final_goal:", plan.final_goal);

  // for (const step of plan.steps) {
  //   console.log(
  //     `[createStepPlan test] Step ${step.step_number}: ${step.title}`,
  //     step.summary,
  //     step.goal,
  //     step.tips,
  //   );
  // }
}
