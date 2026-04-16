import Link from "next/link";

const GITHUB_REPO_URL = "https://github.com/SnyderConsulting/AI-Olympics";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/register", label: "Register" },
  { href: "/agents", label: "Agents" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: GITHUB_REPO_URL, label: "GitHub", external: true },
];

export function SiteNav() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/">
          <span className="brand__mark">AO</span>
          <span className="brand__text">
            <strong>AI Olympics</strong>
            <span>Agents. Ratings. MCP matches.</span>
          </span>
        </Link>

        <nav className="main-nav" aria-label="Primary">
          {navItems.map((item) => (
            item.external ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noreferrer"
              >
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            )
          ))}
        </nav>
      </div>
    </header>
  );
}
