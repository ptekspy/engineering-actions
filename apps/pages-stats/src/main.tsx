import React from "react";
import ReactDOM from "react-dom/client";
import reportData from "./generated/open-prs.json";
import "./styles.css";

type PullRequestReportRow = {
  repository: string;
  title: string;
  url: string;
  updatedAt: string;
  reviewStatus: string;
  ciStatus: string;
  readyToMerge: boolean;
};

type RepositoryStatsData = {
  repository: string;
  path: string;
  pullRequestCount: number;
  pullRequests: PullRequestReportRow[];
};

type NavigationCard = {
  eyebrow: string;
  title: string;
  description: string;
  path: string;
};

type PagesStatsData = {
  generatedAt: string;
  repositoryToManagePages: string;
  siteBasePath: string;
  overviewPath: string;
  navigationCards: NavigationCard[];
  repositories: RepositoryStatsData[];
  pullRequests: PullRequestReportRow[];
};

const data = reportData as PagesStatsData;

function App() {
  const activeRoute = getActiveRoute(window.location.pathname, data.siteBasePath);
  const useSiteBasePath = shouldUseSiteBasePath(window.location.pathname, data.siteBasePath);
  const repositoryPath = getRepositoryPath(activeRoute);
  const repositoryStats = repositoryPath
    ? data.repositories.find((repository) => repository.path === repositoryPath)
    : undefined;
  const isHomePage = activeRoute === "/";
  const isOpenPrsOverviewPage = activeRoute === data.overviewPath;
  const title = repositoryStats
    ? repositoryStats.repository
    : isOpenPrsOverviewPage
      ? "Open PRs"
      : "Engineering Actions";
  const subtitle = repositoryStats
    ? `Repository detail for ${repositoryStats.repository}`
    : isOpenPrsOverviewPage
      ? `Open pull request overview for ${data.repositories.length} monitored repositories.`
      : `Managed pages repo: ${data.repositoryToManagePages}`;
  const openPullRequestCount = repositoryStats ? repositoryStats.pullRequests.length : data.pullRequests.length;

  return (
    <main className="page-shell">
      <header className="hero">
        {repositoryStats ? <a className="back-link" href={buildHref(data.overviewPath, data.siteBasePath, useSiteBasePath)}>Open PRs</a> : null}
        {isOpenPrsOverviewPage || repositoryStats ? <a className="back-link" href={buildHref("/", data.siteBasePath, useSiteBasePath)}>Home</a> : null}
        <p className="eyebrow">Engineering Actions</p>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
        <div className="meta-grid">
          <div>
            <span className="meta-label">Open PRs</span>
            <strong>{openPullRequestCount}</strong>
          </div>
          <div>
            <span className="meta-label">Generated</span>
            <strong>{formatDate(data.generatedAt)}</strong>
          </div>
        </div>
      </header>

      {isHomePage ? <NavigationCards cards={data.navigationCards} siteBasePath={data.siteBasePath} useSiteBasePath={useSiteBasePath} /> : null}
      {isOpenPrsOverviewPage ? <RepositoryCards repositories={data.repositories} siteBasePath={data.siteBasePath} useSiteBasePath={useSiteBasePath} /> : null}
      {repositoryStats ? <PullRequestTable pullRequests={repositoryStats.pullRequests} /> : null}
      {!isHomePage && !isOpenPrsOverviewPage && !repositoryStats ? (
        <section className="panel empty-state">
          <p>Page not found.</p>
        </section>
      ) : null}
    </main>
  );
}

function NavigationCards({
  cards,
  siteBasePath,
  useSiteBasePath
}: {
  cards: NavigationCard[];
  siteBasePath: string;
  useSiteBasePath: boolean;
}) {
  return (
    <section className="card-grid">
      {cards.map((card) => (
        <a className="nav-card" href={buildHref(card.path, siteBasePath, useSiteBasePath)} key={card.path}>
          <span className="meta-label">{card.eyebrow}</span>
          <strong>{card.title}</strong>
          <span className="card-description">{card.description}</span>
        </a>
      ))}
    </section>
  );
}

function RepositoryCards({
  repositories,
  siteBasePath,
  useSiteBasePath
}: {
  repositories: RepositoryStatsData[];
  siteBasePath: string;
  useSiteBasePath: boolean;
}) {
  return (
    <section className="card-grid">
      {repositories.map((repository) => (
        <a className="repo-card" href={buildHref(repository.path, siteBasePath, useSiteBasePath)} key={repository.repository}>
          <span className="meta-label">Repository</span>
          <strong>{repository.repository}</strong>
          <span>{repository.pullRequestCount} open PRs</span>
        </a>
      ))}
    </section>
  );
}

function PullRequestTable({ pullRequests }: { pullRequests: PullRequestReportRow[] }) {
  return (
    <section className="panel">
      <table>
        <thead>
          <tr>
            <th>PR title- linked</th>
            <th>Review Status</th>
            <th>CI check</th>
            <th>ready to merge</th>
          </tr>
        </thead>
        <tbody>
          {pullRequests.length === 0 ? (
            <tr>
              <td colSpan={4}>No open pull requests found.</td>
            </tr>
          ) : (
            pullRequests.map((pullRequest) => (
              <tr key={pullRequest.url}>
                <td>
                  <a className="pr-link" href={pullRequest.url} target="_blank" rel="noreferrer">
                    {pullRequest.title}
                  </a>
                </td>
                <td>{pullRequest.reviewStatus}</td>
                <td>{pullRequest.ciStatus}</td>
                <td>
                  <span className={pullRequest.readyToMerge ? "status-pill ready" : "status-pill blocked"}>
                    {pullRequest.readyToMerge ? "yes" : "no"}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

function getActiveRoute(pathname: string, siteBasePath: string): string {
  const normalizedPathname = normalizePath(pathname);
  const normalizedSiteBasePath = normalizePath(siteBasePath);

  if (normalizedSiteBasePath !== "/" && normalizedPathname.startsWith(normalizedSiteBasePath)) {
    const remainder = normalizedPathname.slice(normalizedSiteBasePath.length);

    return remainder ? normalizePath(`/${remainder}`) : "/";
  }

  return normalizedPathname;
}

function getRepositoryPath(routePath: string): string | null {
  const segments = normalizePath(routePath).split("/").filter(Boolean);
  const openPrsIndex = segments.indexOf("open-prs");

  if (openPrsIndex === -1 || segments.length < openPrsIndex + 3) {
    return null;
  }

  const repositorySegments = segments.slice(openPrsIndex + 1, openPrsIndex + 3);

  return `/open-prs/${repositorySegments.join("/")}/`;
}

function shouldUseSiteBasePath(pathname: string, siteBasePath: string): boolean {
  const normalizedSiteBasePath = normalizePath(siteBasePath);

  return normalizedSiteBasePath !== "/" && normalizePath(pathname).startsWith(normalizedSiteBasePath);
}

function buildHref(routePath: string, siteBasePath: string, useSiteBasePath: boolean): string {
  const normalizedRoutePath = normalizePath(routePath);
  const normalizedSiteBasePath = normalizePath(siteBasePath);

  if (!useSiteBasePath || normalizedSiteBasePath === "/") {
    return normalizedRoutePath;
  }

  return normalizedRoutePath === "/"
    ? normalizedSiteBasePath
    : `${normalizedSiteBasePath.slice(0, -1)}${normalizedRoutePath}`;
}

function normalizePath(pathname: string): string {
  const [pathWithoutQuery] = pathname.split(/[?#]/);
  const normalized = pathWithoutQuery === "" ? "/" : pathWithoutQuery;

  if (normalized === "/") {
    return "/";
  }

  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);