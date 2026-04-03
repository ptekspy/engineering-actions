import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepositoryConfigPath = path.resolve(__dirname, "../../../repositories.json");

type PullRequest = {
	number: number;
	title: string;
	url: string;
	updatedAt: string;
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
};

type RepositoryConfig = Record<string, RepositoryPolicy>;

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

		const { minimumHumanReview = 0, requiredCiStatusChecks = [] } = policy as Partial<RepositoryPolicy>;

		if (!Number.isInteger(minimumHumanReview) || minimumHumanReview < 0) {
			throw new Error(`Invalid minimumHumanReview for ${repository} in ${source}. Expected a non-negative integer.`);
		}

		if (!Array.isArray(requiredCiStatusChecks) || requiredCiStatusChecks.some((value) => typeof value !== "string")) {
			throw new Error(`Invalid requiredCiStatusChecks for ${repository} in ${source}. Expected an array of strings.`);
		}

		normalized[repository] = {
			minimumHumanReview,
			requiredCiStatusChecks
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
			requiredCiStatusChecks: []
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
		"number,title,url,updatedAt"
	]);

	const parsed = JSON.parse(stdout) as PullRequest[];

	return Promise.all(parsed.map((pullRequest) => hydratePullRequestReportRow(repository, policy, pullRequest)));
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

function escapeTableCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
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
	await writeStepSummary(markdown);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : "Unknown error";
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});
