// Production server for self-hosting (used by the Docker image instead of
// `remix-serve`). remix-serve installs the @remix-run/web-fetch polyfill as the
// global fetch unless the v3_singleFetch future flag is on; that polyfill resets
// the connection when talking to PostgREST over a container network, breaking
// every DB call. We install globals with nativeFetch:true so the server uses
// Node's native (undici) fetch, which works. See CLAUDE.md / deploy notes.
import { createRequestHandler } from "@remix-run/express";
import { installGlobals } from "@remix-run/node";
import express from "express";

installGlobals({ nativeFetch: true });

const build = await import("./build/server/index.js");

const app = express();
app.disable("x-powered-by");

// Hashed client assets are immutable; everything else in public/ (incl.
// runtime-uploaded assets under public/cgi/asset) is served normally.
app.use(
  "/assets",
  express.static("build/client/assets", { immutable: true, maxAge: "1y" })
);
app.use(express.static("build/client", { maxAge: "1h" }));
app.use(express.static("public", { maxAge: "1h" }));

app.all("*", createRequestHandler({ build, mode: process.env.NODE_ENV }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Webstudio builder listening on http://0.0.0.0:${port}`);
});
