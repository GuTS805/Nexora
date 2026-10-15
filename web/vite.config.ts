import { defaultClientConditions, defaultServerConditions, defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Serves the repo-root `api/*.ts` (Vercel functions) during `vite dev`, so the gas sponsor can be exercised
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
          // Functions live in the repo-root api/ folder, where Vercel serves them from.
          const mod = await server.ssrLoadModule(fileURLToPath(new URL(`../api/${name}.ts`, import.meta.url)));
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

/**
 * `vite build --mode portable` → dist-portable/nexora.html: one self-contained file with the JS and
 * CSS inlined. Browsers refuse to load `<script type="module" src>` from file://, so the normal build
 * needs a web server; this one opens straight from disk, an email attachment or a WhatsApp/Telegram
 * file share, and still reads Arkiv directly.
 */
function inlineEverything(): Plugin {
  return {
    name: "nexora-inline-everything",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.type === "asset" && f.fileName.endsWith(".html"));
      if (!html || html.type !== "asset") return;
      let source = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk" && file.isEntry) {
          const tag = new RegExp(`<script[^>]*src="[^"]*${file.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*></script>`);
          source = source.replace(tag, () => `<script type="module">${file.code.replace(/<\/script/gi, "<\\/script")}</script>`);
          delete bundle[name];
        } else if (file.type === "asset" && file.fileName.endsWith(".css")) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${file.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
          source = source.replace(tag, () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        } else if (file.type === "asset" && file.fileName.endsWith(".png") && source.includes(file.fileName)) {
          // The favicon is linked from index.html, which Vite never inlines on its own.
          const uri = `data:image/png;base64,${Buffer.from(file.source).toString("base64")}`;
          source = source.split(`./${file.fileName}`).join(uri);
          delete bundle[name];
        }
      }
      html.source = source;
      html.fileName = "nexora.html";
    },
  };
}

export default defineConfig(({ mode }) => {
  const portable = mode === "portable";
  return {
    plugins: [react(), devApi(), ...(portable ? [inlineEverything()] : [])],
    // Relative asset paths: the build runs from any static host or IPFS gateway.
    base: "./",
    // Preact's React-compatible runtime: same components, about a fifth of the size — it matters on
    // the slow mobile connections many riders use.
    resolve: {
      // The workspace's nexora-ledger is used from source; only the npm package ships compiled code.
      conditions: ["nexora-source", ...defaultClientConditions],
      alias: {
        "react-dom/client": "preact/compat/client",
        "react-dom": "preact/compat",
        "react/jsx-runtime": "preact/jsx-runtime",
        "react/jsx-dev-runtime": "preact/jsx-dev-runtime",
        react: "preact/compat",
      },
    },
    // The portable build is one file; icons and the install manifest only matter when hosted.
    // Server-side code (the dev API and the tests) resolves nexora-ledger from source too.
    ssr: { resolve: { conditions: ["nexora-source", ...defaultServerConditions], externalConditions: ["nexora-source"] } },
    publicDir: portable ? false : "public",
    build: {
      target: "es2022",
      outDir: portable ? "dist-portable" : "dist",
      ...(portable ? { rolldownOptions: { output: { codeSplitting: false } }, assetsInlineLimit: Number.MAX_SAFE_INTEGER } : {}),
    },
  };
});
