import reportData from "./generated/open-prs.json";

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

type PagesStatsData = {
  generatedAt: string;
  repositoryToManagePages: string;
  overviewPath: string;
  repositories: RepositoryStatsData[];
  pullRequests: PullRequestReportRow[];
};

const data = reportData as PagesStatsData;

function App() {
  const repositoryPath = getRepositoryPath(window.location.pathname);
  const repositoryStats = repositoryPath
    ? data.repositories.find((repository) => repository.path === repositoryPath)
    : undefined;
  const title = repositoryStats ? repositoryStats.repository : "Open PR Report";
  const subtitle = repositoryStats
    ? `Repository detail for ${repositoryStats.repository}`
    : `Managed pages repo: ${data.repositoryToManagePages}`;
  const pullRequests = repositoryStats ? repositoryStats.pullRequests : data.pullRequests;

  return (
    <main className="page-shell">
      <header className="hero">
        {repositoryStats ? (
          <a className="back-link" href={data.overviewPath}>
            All repositories
          </a>
        ) : null}
        <p className="eyebrow">Engineering Actions</p>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
        <div className="meta-grid">
          <div>
            <span className="meta-label">Open PRs</span>
            <strong>{pullRequests.length}</strong>
          </div>
          <div>
            <span className="meta-label">Generated</span>
            <strong>{formatDate(data.generatedAt)}</strong>
          </div>
        </div>
      </header>

      {!repositoryStats ? <RepositoryCards repositories={data.repositories} /> : null}

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Repo title- linked</th>
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
                    {!repositoryStats ? (
                      <div className="repo-cell-stack">
                        <a
                          className="repo-link"
                          href={data.repositories.find((repository) => repository.repository === pullRequest.repository)?.path ?? data.overviewPath}
                        >
                          {pullRequest.repository}
                        </a>
                        <a className="pr-link" href={pullRequest.url} target="_blank" rel="noreferrer">
                          {pullRequest.title}
                        </a>
                      </div>
                    ) : (
                      <a className="pr-link" href={pullRequest.url} target="_blank" rel="noreferrer">
                        {pullRequest.title}
                      </a>
                    )}
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
    </main>
  );
}

function RepositoryCards({ repositories }: { repositories: RepositoryStatsData[] }) {
  return (
    <section className="repo-grid">
      {repositories.map((repository) => (
        <a className="repo-card" href={repository.path} key={repository.repository}>
          <span className="meta-label">Repository</span>
          <strong>{repository.repository}</strong>
          <span>{repository.pullRequestCount} open PRs</span>
        </a>
      ))}
    </section>
  );
}

function getRepositoryPath(pathname: string): string | null {
  const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const segments = normalized.split("/").filter(Boolean);
  const openPrsIndex = segments.indexOf("open-prs");

  if (openPrsIndex === -1 || segments.length < openPrsIndex + 3) {
    return null;
  }

  const repositorySegments = segments.slice(openPrsIndex + 1, openPrsIndex + 3);

  return `/open-prs/${repositorySegments.join("/")}/`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export default App;