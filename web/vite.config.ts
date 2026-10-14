import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Serves `api/*.ts` (Vercel functions) during `vite dev`, so the gas sponsor can be exercised
 * locally exactly as it runs in production. The production build itself is fully static.
 */
function devApi(): Plugin {
  return {
    name: "nexora-dev-api",
    configureServer(server) {
      // Server-only secrets for the dev API, from the repo-root .env.local. Never exposed to the bundle.
      Object.assign(process.env, { ...loadEnv("development", "..", "NEXORA_"), ...process.env });
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const name = req.url.slice(5).split("?")[0];
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const handler = mod[req.method ?? "GET"];
          if (typeof handler !== "function") {
            res.statusCode = 405;
            return res.end();
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });
          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          server.ssrFixStacktrace(error as Error);
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  // Relative asset paths: the build runs from any static host, IPFS gateway or a local folder.
  base: "./",
  build: { target: "es2022" },
});
