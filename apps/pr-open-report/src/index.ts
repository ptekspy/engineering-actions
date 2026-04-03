import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepositoryConfigPath = path.resolve(__dirname, "../../../repositories.json");
const defaultPagesConfigPath = path.resolve(__dirname, "../../../pages.config.ts");

type PullRequest = {
	number: number;
	title: string;
	url: string;
	updatedAt: string;
	baseRefName: string;
};

type PullRequestReview = {
	author: {
		login: string;
	} | null;
	state: string;
};

type StatusCheckRollupItem = {
	context?: string;
	name?: string;
	state?: string;
	status?: string;
	conclusion?: string | null;
};

type PullRequestDetails = {
	latestReviews: PullRequestReview[];
	statusCheckRollup: StatusCheckRollupItem[];
};

type PullRequestReportRow = PullRequest & {
	repository: string;
	reviewStatus: string;
	ciStatus: string;
	readyToMerge: boolean;
};

type RepositoryPolicy = {
	minimumHumanReview: number;
	requiredCiStatusChecks: string[];
	baseBranches: string[];
};

type RepositoryConfig = Record<string, RepositoryPolicy>;

type PagesConfig = {
	repositoryToManagePages: string;
};

async function ensureGhAvailable(): Promise<void> {
	try {
		await execFileAsync("gh", ["--version"]);
	} catch {
		throw new Error("GitHub CLI is required but was not found on PATH.");
	}
}

async function parseRepositoryConfig(): Promise<RepositoryConfig> {
	const fromEnv = process.env.PR_REPOSITORIES;

	if (fromEnv) {
		return normalizeRepositoryConfig(safeJsonParse(fromEnv, "PR_REPOSITORIES"), "PR_REPOSITORIES");
	}

	const raw = await readFile(defaultRepositoryConfigPath, "utf8");

	return normalizeRepositoryConfig(safeJsonParse(raw, defaultRepositoryConfigPath), defaultRepositoryConfigPath);
}

function safeJsonParse(raw: string, source: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(`Could not parse JSON from ${source}.`);
	}
}

async function parsePagesConfig(): Promise<PagesConfig> {
	const raw = await readFile(defaultPagesConfigPath, "utf8");
	const match = raw.match(/repositoryToManagePages\s*:\s*["'`]([^"'`]+)["'`]/);

	const repositoryToManagePages = match?.[1];

	if (!repositoryToManagePages) {
		throw new Error(`Invalid pages config in ${defaultPagesConfigPath}. Expected repositoryToManagePages string field.`);
	}

	assertValidRepositoryName(repositoryToManagePages, defaultPagesConfigPath);

	return {
		repositoryToManagePages
	};
}

function normalizeRepositoryConfig(raw: unknown, source: string): RepositoryConfig {
	if (Array.isArray(raw)) {
		return normalizeLegacyRepositoryList(raw, source);
	}

	if (typeof raw !== "object" || raw === null) {
		throw new Error(`Invalid repository config in ${source}. Expected an object keyed by owner/repo.`);
	}

	const normalized: RepositoryConfig = {};

	for (const [repository, policy] of Object.entries(raw)) {
		assertValidRepositoryName(repository, source);

		if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
			throw new Error(`Invalid config for ${repository} in ${source}. Expected an object.`);
		}

		const { minimumHumanReview = 0, requiredCiStatusChecks = [], baseBranches = [] } = policy as Partial<RepositoryPolicy>;

		if (!Number.isInteger(minimumHumanReview) || minimumHumanReview < 0) {
			throw new Error(`Invalid minimumHumanReview for ${repository} in ${source}. Expected a non-negative integer.`);
		}

		if (!Array.isArray(requiredCiStatusChecks) || requiredCiStatusChecks.some((value) => typeof value !== "string")) {
			throw new Error(`Invalid requiredCiStatusChecks for ${repository} in ${source}. Expected an array of strings.`);
		}

		if (!Array.isArray(baseBranches) || baseBranches.some((value) => typeof value !== "string" || value.trim() === "")) {
			throw new Error(`Invalid baseBranches for ${repository} in ${source}. Expected an array of non-empty strings.`);
		}

		normalized[repository] = {
			minimumHumanReview,
			requiredCiStatusChecks,
			baseBranches
		};
	}

	return normalized;
}

function normalizeLegacyRepositoryList(raw: unknown[], source: string): RepositoryConfig {
	const normalized: RepositoryConfig = {};

	for (const value of raw) {
		if (typeof value !== "string") {
			throw new Error(`Invalid repository entry in ${source}. Expected owner/repo strings.`);
		}

		assertValidRepositoryName(value, source);
		normalized[value] = {
			minimumHumanReview: 0,
			requiredCiStatusChecks: [],
			baseBranches: []
		};
	}

	return normalized;
}

function assertValidRepositoryName(repository: string, source: string): void {
	const [owner, repo, ...rest] = repository.split("/");

	if (!owner || !repo || rest.length > 0) {
		throw new Error(`Invalid repository entry: ${repository} in ${source}. Expected owner/repo format.`);
	}
}

async function listOpenPullRequests(repository: string, policy: RepositoryPolicy): Promise<PullRequestReportRow[]> {
	const { stdout } = await execFileAsync("gh", [
		"pr",
		"list",
		"--repo",
		repository,
		"--state",
		"open",
		"--limit",
		"100",
		"--json",
		"number,title,url,updatedAt,baseRefName"
	]);

	const parsed = (JSON.parse(stdout) as PullRequest[]).filter((pullRequest) => matchesBaseBranchPolicy(pullRequest, policy));

	return Promise.all(parsed.map((pullRequest) => hydratePullRequestReportRow(repository, policy, pullRequest)));
}

function matchesBaseBranchPolicy(pullRequest: PullRequest, policy: RepositoryPolicy): boolean {
	if (policy.baseBranches.length === 0) {
		return true;
	}

	return policy.baseBranches.includes(pullRequest.baseRefName);
}

async function hydratePullRequestReportRow(
	repository: string,
	policy: RepositoryPolicy,
	pullRequest: PullRequest
): Promise<PullRequestReportRow> {
	const details = await getPullRequestDetails(repository, pullRequest.number);
	const approvedReviewers = getApprovedReviewerLogins(details.latestReviews);
	const failingRequiredChecks = getFailingRequiredChecks(policy.requiredCiStatusChecks, details.statusCheckRollup);
	const hasRequiredReviews = approvedReviewers.length >= policy.minimumHumanReview;
	const allRequiredChecksPassing = failingRequiredChecks.length === 0;

	return {
		...pullRequest,
		repository,
		reviewStatus: formatReviewStatus(policy.minimumHumanReview, approvedReviewers),
		ciStatus: failingRequiredChecks.length === 0 ? "0" : failingRequiredChecks.join(", "),
		readyToMerge: hasRequiredReviews && allRequiredChecksPassing
	};
}

async function getPullRequestDetails(repository: string, pullRequestNumber: number): Promise<PullRequestDetails> {
	const { stdout } = await execFileAsync("gh", [
		"pr",
		"view",
		String(pullRequestNumber),
		"--repo",
		repository,
		"--json",
		"latestReviews,statusCheckRollup"
	]);

	const parsed = JSON.parse(stdout) as Partial<PullRequestDetails>;

	return {
		latestReviews: Array.isArray(parsed.latestReviews) ? parsed.latestReviews : [],
		statusCheckRollup: Array.isArray(parsed.statusCheckRollup) ? parsed.statusCheckRollup : []
	};
}

function getApprovedReviewerLogins(reviews: PullRequestReview[]): string[] {
	const approvedReviewerLogins = new Set<string>();

	for (const review of reviews) {
		if (review.state !== "APPROVED" || !review.author?.login) {
			continue;
		}

		approvedReviewerLogins.add(review.author.login);
	}

	return [...approvedReviewerLogins].sort((left, right) => left.localeCompare(right));
}

function formatReviewStatus(minimumHumanReview: number, approvedReviewerLogins: string[]): string {
	if (approvedReviewerLogins.length >= minimumHumanReview) {
		return "0";
	}

	if (approvedReviewerLogins.length === 0) {
		return String(minimumHumanReview);
	}

	return approvedReviewerLogins.map((login) => getReviewerInitial(login)).join(" ");
}

function getReviewerInitial(login: string): string {
	const match = login.match(/[A-Za-z0-9]/);

	return match ? match[0].toUpperCase() : "?";
}

function getFailingRequiredChecks(requiredCiStatusChecks: string[], statusCheckRollup: StatusCheckRollupItem[]): string[] {
	const failingChecks: string[] = [];

	for (const requiredCheck of requiredCiStatusChecks) {
		const matchingCheck = statusCheckRollup.find((statusCheck) => getStatusCheckName(statusCheck) === requiredCheck);

		if (!matchingCheck || !isSuccessfulStatusCheck(matchingCheck)) {
			failingChecks.push(requiredCheck);
		}
	}

	return failingChecks;
}

function getStatusCheckName(statusCheck: StatusCheckRollupItem): string {
	return statusCheck.name ?? statusCheck.context ?? "";
}

function isSuccessfulStatusCheck(statusCheck: StatusCheckRollupItem): boolean {
	const conclusion = statusCheck.conclusion?.toUpperCase();

	if (conclusion) {
		return conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED";
	}

	const state = statusCheck.state?.toUpperCase() ?? statusCheck.status?.toUpperCase();

	return state === "SUCCESS";
}

function buildMarkdownReport(pullRequests: PullRequestReportRow[]): string {
	const lines = ["# Open Pull Requests", "", `Total open PRs: ${pullRequests.length}`, ""];

	if (pullRequests.length === 0) {
		lines.push("No open pull requests found.");
		return lines.join("\n");
	}

	lines.push(
		"| Repo title- linked | Review Status | CI check | ready to merge |",
		"| --- | --- | --- | --- |"
	);

	for (const pullRequest of pullRequests) {
		lines.push(
			`| [${escapeTableCell(`${pullRequest.repository} - ${pullRequest.title}`)}](${pullRequest.url}) | ${pullRequest.reviewStatus} | ${escapeTableCell(pullRequest.ciStatus)} | ${pullRequest.readyToMerge ? "yes" : "no"} |`
		);
	}

	return lines.join("\n");
}

function buildHtmlReport(title: string, subtitle: string, pullRequests: PullRequestReportRow[], repositoryPageLinks?: Map<string, string>): string {
	const generatedAt = new Date().toISOString();
	const rows = pullRequests.length === 0
		? '<tr><td colspan="4">No open pull requests found.</td></tr>'
		: pullRequests
			.map((pullRequest) => buildHtmlRow(pullRequest, repositoryPageLinks))
			.join("");

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)}</title>
	<style>
		:root {
			color-scheme: light;
			--background: #f6f7f4;
			--panel: #ffffff;
			--foreground: #17202a;
			--muted: #5f6b76;
			--line: #d7dde3;
			--accent: #0f6cbd;
			--success: #0f7b3e;
			font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
		}

		body {
			margin: 0;
			background: linear-gradient(180deg, #eef5ff 0%, var(--background) 45%, #f6f7f4 100%);
			color: var(--foreground);
		}

		main {
			max-width: 1100px;
			margin: 0 auto;
			padding: 48px 20px 72px;
		}

		header {
			margin-bottom: 24px;
		}

		h1 {
			margin: 0 0 8px;
			font-size: clamp(2rem, 4vw, 3.5rem);
			line-height: 0.95;
		}

		p {
			margin: 0;
			color: var(--muted);
		}

		section {
			background: var(--panel);
			border: 1px solid var(--line);
			border-radius: 18px;
			overflow: hidden;
			box-shadow: 0 18px 50px rgba(16, 24, 40, 0.08);
		}

		table {
			width: 100%;
			border-collapse: collapse;
		}

		th,
		td {
			padding: 14px 16px;
			text-align: left;
			border-bottom: 1px solid var(--line);
			vertical-align: top;
		}

		th {
			background: #f8fbff;
			font-size: 0.84rem;
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--muted);
		}

		tr:last-child td {
			border-bottom: 0;
		}

		a {
			color: var(--accent);
			text-decoration: none;
		}

		a:hover {
			text-decoration: underline;
		}

		.ready {
			color: var(--success);
			font-weight: 600;
		}

		footer {
			margin-top: 18px;
			font-size: 0.92rem;
			color: var(--muted);
		}

		nav {
			margin: 0 0 18px;
		}

		nav a {
			font-size: 0.92rem;
		}

		@media (max-width: 720px) {
			main {
				padding: 28px 12px 40px;
			}

			th,
			td {
				padding: 12px;
				font-size: 0.92rem;
			}
		}
	</style>
</head>
<body>
	<main>
		<header>
			<h1>${escapeHtml(title)}</h1>
			<p>${escapeHtml(subtitle)}</p>
			<p>Total open PRs: ${pullRequests.length}</p>
		</header>
		<section>
			<table>
				<thead>
					<tr>
						<th>Repo title- linked</th>
						<th>Review Status</th>
						<th>CI check</th>
						<th>ready to merge</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		</section>
		<footer>Generated at ${escapeHtml(generatedAt)}</footer>
	</main>
</body>
</html>`;
}

function buildHtmlRow(pullRequest: PullRequestReportRow, repositoryPageLinks?: Map<string, string>): string {
	const repoPageLink = repositoryPageLinks?.get(pullRequest.repository);
	const repositoryLabel = `${pullRequest.repository} - ${pullRequest.title}`;
	const cellContent = repoPageLink
		? `<div><a href="${escapeHtmlAttribute(repoPageLink)}">${escapeHtml(pullRequest.repository)}</a></div><div><a href="${escapeHtmlAttribute(pullRequest.url)}">${escapeHtml(pullRequest.title)}</a></div>`
		: `<a href="${escapeHtmlAttribute(pullRequest.url)}">${escapeHtml(repositoryLabel)}</a>`;

	return `<tr><td>${cellContent}</td><td>${escapeHtml(pullRequest.reviewStatus)}</td><td>${escapeHtml(pullRequest.ciStatus)}</td><td>${pullRequest.readyToMerge ? "yes" : "no"}</td></tr>`;
}

function escapeTableCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string): string {
	return escapeHtml(value);
}

async function writeStepSummary(markdown: string): Promise<void> {
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;

	if (!summaryPath) {
		return;
	}

	try {
		await access(summaryPath, constants.F_OK);
		await appendFile(summaryPath, `${markdown}\n`, "utf8");
	} catch {
		throw new Error(`Could not write GitHub step summary at ${summaryPath}.`);
	}
}

async function writePagesSite(pullRequests: PullRequestReportRow[]): Promise<void> {
	const outputDir = process.env.PAGES_OUTPUT_DIR;

	if (!outputDir) {
		return;
	}

	const pagesConfig = await parsePagesConfig();
	const openPrsDir = path.join(outputDir, "open-prs");
	const repositoryGroups = groupByRepository(pullRequests);
	const repositoryPageLinks = new Map<string, string>();

	await mkdir(openPrsDir, { recursive: true });

	for (const repository of repositoryGroups.keys()) {
		repositoryPageLinks.set(repository, `../${repository}/`);
	}

	await writeFile(
		path.join(outputDir, "index.html"),
		buildIndexRedirectHtml("open-prs/"),
		"utf8"
	);
	await writeFile(
		path.join(openPrsDir, "index.html"),
		buildHtmlReport(
			"Open PR Report",
			`Managed pages repo: ${pagesConfig.repositoryToManagePages}`,
			pullRequests,
			repositoryPageLinks
		),
		"utf8"
	);

	for (const [repository, repositoryPullRequests] of repositoryGroups) {
		const repositoryDir = path.join(openPrsDir, repository);
		await mkdir(repositoryDir, { recursive: true });
		await writeFile(
			path.join(repositoryDir, "index.html"),
			buildHtmlReport(
				`Open PR Report: ${repository}`,
				`Managed pages repo: ${pagesConfig.repositoryToManagePages}`,
				repositoryPullRequests
			),
			"utf8"
		);
	}

	await writeFile(
		path.join(outputDir, ".nojekyll"),
		"",
		"utf8"
	);
}

function buildIndexRedirectHtml(target: string): string {
	const escapedTarget = escapeHtmlAttribute(target);

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta http-equiv="refresh" content="0; url=${escapedTarget}">
	<title>Redirecting</title>
</head>
<body>
	<p>Redirecting to <a href="${escapedTarget}">${escapeHtml(target)}</a>.</p>
</body>
</html>`;
}

function groupByRepository(pullRequests: PullRequestReportRow[]): Map<string, PullRequestReportRow[]> {
	const grouped = new Map<string, PullRequestReportRow[]>();

	for (const pullRequest of pullRequests) {
		const existing = grouped.get(pullRequest.repository) ?? [];
		existing.push(pullRequest);
		grouped.set(pullRequest.repository, existing);
	}

	return new Map([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function main(): Promise<void> {
	await ensureGhAvailable();

	const repositories = Object.entries(await parseRepositoryConfig());

	if (repositories.length === 0) {
		throw new Error("No repositories configured.");
	}

	const results = await Promise.all(repositories.map(([repository, policy]) => listOpenPullRequests(repository, policy)));
	const pullRequests = results.flat().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	const markdown = buildMarkdownReport(pullRequests);

	process.stdout.write(`${markdown}\n`);
	await writePagesSite(pullRequests);
	await writeStepSummary(markdown);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : "Unknown error";
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});
