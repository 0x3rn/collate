import handler from "vinext/server/app-router-entry";

export { HelloSleepWorkflow } from "./workflows/hello-sleep";

export default {
  async fetch(request: Request): Promise<Response> {
    return handler.fetch(request);
  },
};
