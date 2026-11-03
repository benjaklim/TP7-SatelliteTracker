import { buildApp } from './app.ts';

const app = buildApp({
  spaceTrackIdentity: process.env.SPACETRACK_IDENTITY,
  spaceTrackPassword: process.env.SPACETRACK_PASSWORD,
  n2yoApiKey: process.env.N2YO_API_KEY,
  logger: true,
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
