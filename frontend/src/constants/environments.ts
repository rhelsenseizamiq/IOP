import type { Environment } from "../types/ipRecord";

export const ENV_OPTIONS: Environment[] = [
  "Production",
  "Staging",
  "UAT",
  "QA",
  "Test",
  "Development",
  "DR",
  "Lab",
];

export const ENV_COLOR: Record<Environment, string> = {
  Production: "default",
  Staging: "default",
  UAT: "default",
  QA: "default",
  Test: "default",
  Development: "default",
  DR: "default",
  Lab: "default",
};
