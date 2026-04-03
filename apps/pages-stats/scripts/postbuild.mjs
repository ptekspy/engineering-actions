import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const distRoot = path.join(appRoot, "dist");
const openPrsRoot = path.join(distRoot, "open-prs");
const reportDataPath = path.join(appRoot, "src", "generated", "open-prs.json");

const reportData = JSON.parse(await readFile(reportDataPath, "utf8"));

await writeFile(path.join(distRoot, "index.html"), buildRedirectHtml("open-prs/"), "utf8");
await copyFile(path.join(openPrsRoot, "index.html"), path.join(distRoot, "404.html"));

for (const repository of reportData.repositories) {
  const repositoryRelativePath = repository.path.replace(/^\//, "");
  const repositoryDir = path.join(distRoot, repositoryRelativePath);
  await mkdir(repositoryDir, { recursive: true });
  await copyFile(path.join(openPrsRoot, "index.html"), path.join(repositoryDir, "index.html"));
}

function buildRedirectHtml(target) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=${target}" />
    <title>Redirecting</title>
  </head>
  <body>
    <p>Redirecting to <a href="${target}">${target}</a>.</p>
  </body>
</html>`;
}