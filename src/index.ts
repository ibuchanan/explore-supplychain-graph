import { dispatch } from "./rpc";

type WebtriggerRequest = { method: string; body?: string };

export const runSync = async (request: WebtriggerRequest) => {
  if (request.method !== "POST") {
    return {
      body: "",
      headers: { "Content-Type": ["application/json"], Allow: ["POST"] },
      statusCode: 405,
    };
  }
  return {
    body: JSON.stringify(await dispatch(request.body ?? "")),
    headers: { "Content-Type": ["application/json"] },
    statusCode: 200,
  };
};

export const runAsync = runSync;
