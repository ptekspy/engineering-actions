import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pagesConfigPath = path.resolve(__dirname, "../../pages.config.ts");

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "serve" ? "/" : getOpenPrsBasePath(),
  server: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: "dist/open-prs",
    emptyOutDir: true
  }
}));

function getOpenPrsBasePath(): string {
  const repository = readPagesRepository();
  const siteBasePath = getPagesSiteBasePath(repository);

  return siteBasePath === "/" ? "/open-prs/" : `${siteBasePath}open-prs/`;
}

function readPagesRepository(): string {
  const raw = readFileSync(pagesConfigPath, "utf8");
  const match = raw.match(/repositoryToManagePages\s*:\s*["'`]([^"'`]+)["'`]/);
  const repository = match?.[1];

  if (!repository) {
    throw new Error(`Invalid pages config in ${pagesConfigPath}. Expected repositoryToManagePages string field.`);
  }

  return repository;
}

function getPagesSiteBasePath(repository: string): string {
  const [owner, repo, ...rest] = repository.split("/");

  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Invalid repository entry: ${repository} in ${pagesConfigPath}. Expected owner/repo format.`);
  }

  return repo === `${owner}.github.io` ? "/" : `/${repo}/`;
}