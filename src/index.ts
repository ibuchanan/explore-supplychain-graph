const buildOutput = (rnd: number) => ({
  body: '{"hello": "world"}',
  headers: {
    "Content-Type": ["application/json"],
    "X-Request-Id": [`rnd-${rnd}`],
  },
  statusCode: 200,
  statusText: "OK",
});

export const runAsync = (): Promise<ReturnType<typeof buildOutput>> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(buildOutput(Math.random()));
    }, 1000);
  });
};

export const runSync = () => buildOutput(Math.random());
