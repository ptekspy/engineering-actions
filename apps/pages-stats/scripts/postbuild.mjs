import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const distRoot = path.join(appRoot, "dist");
const openPrsRoot = path.join(distRoot, "open-prs");
const reportDataPath = path.join(appRoot, "src", "generated", "open-prs.json");

const reportData = JSON.parse(await readFile(reportDataPath, "utf8"));

await removeStaleDistEntries();

await copyFile(path.join(openPrsRoot, "index.html"), path.join(distRoot, "index.html"));
await copyFile(path.join(openPrsRoot, "index.html"), path.join(distRoot, "404.html"));

for (const repository of reportData.repositories) {
  const repositoryRelativePath = repository.path.replace(/^\//, "");
  const repositoryDir = path.join(distRoot, repositoryRelativePath);
  await mkdir(repositoryDir, { recursive: true });
  await copyFile(path.join(openPrsRoot, "index.html"), path.join(repositoryDir, "index.html"));
}

async function removeStaleDistEntries() {
  const distEntries = await readdir(distRoot, { withFileTypes: true });

  await Promise.all(
    distEntries
      .filter((entry) => entry.name !== "open-prs")
      .map((entry) => rm(path.join(distRoot, entry.name), { recursive: true, force: true }))
  );
}