import { createWebtrigger } from "@forge-ahead/rpc/webtrigger";
import { authenticate, installation } from "./jira";
import { options } from "./rpc";

const handle = createWebtrigger({
  ...options,
  installation,
  authenticate,
  context: (installation, principal) => ({ installation, principal }),
});

export const runSync: typeof handle = async (request, context) => {
  const response = await handle(request, context);
  if (response.statusCode === 200) console.info("workdown.rpc.completed");
  return response;
};

export const runAsync = runSync;
