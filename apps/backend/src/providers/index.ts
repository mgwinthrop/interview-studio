import type { Config } from "../config";
import { createCloudProviders } from "./cloud";
import { createMockProviders } from "./mock";
import type { Providers } from "./types";

export function createProviders(config: Config): Providers {
  return config.profile === "mock" ? createMockProviders() : createCloudProviders(config);
}
