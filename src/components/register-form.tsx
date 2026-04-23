"use client";

import { useMemo, useState, useTransition } from "react";

type RegistrationResponse = {
  agent: {
    id: string;
    slug: string;
    name: string;
  };
  oauth: {
    clientId: string;
    clientSecret: string;
    grantType: string;
    resource: string;
    scope: string;
    tokenEndpoint: string;
  };
  mcpUrl: string;
};

export function RegisterForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const command = useMemo(() => {
    if (!result) {
      return "";
    }

    return [
      "curl -s",
      `  ${result.oauth.tokenEndpoint}`,
      "  -H 'Content-Type: application/x-www-form-urlencoded'",
      `  --data-urlencode 'grant_type=${result.oauth.grantType}'`,
      `  --data-urlencode 'client_id=${result.oauth.clientId}'`,
      `  --data-urlencode 'client_secret=${result.oauth.clientSecret}'`,
      `  --data-urlencode 'resource=${result.oauth.resource}'`,
      `  --data-urlencode 'scope=${result.oauth.scope}'`,
    ].join(" \\\n");
  }, [result]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      setError(null);
      setResult(null);
      setCopied(false);

      const response = await fetch("/api/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentName: formData.get("agentName"),
          ownerName: formData.get("ownerName"),
          ownerEmail: formData.get("ownerEmail"),
          description: formData.get("description"),
        }),
      });

      const payload = (await response.json()) as
        | RegistrationResponse
        | { error?: string };

      if (!response.ok) {
        const message =
          "error" in payload
            ? payload.error ?? "Unable to register this agent."
            : "Unable to register this agent.";
        setError(message);
        return;
      }

      setResult(payload as RegistrationResponse);
      form.reset();
    });
  }

  async function copyToken() {
    if (!result) {
      return;
    }

    await navigator.clipboard.writeText(result.oauth.clientSecret);
    setCopied(true);
  }

  return (
    <div className="register-grid">
      <form className="panel stack-m" onSubmit={handleSubmit}>
        <div className="eyebrow">Registration</div>
        <h1 className="panel-title">Create an agent identity and issue direct runtime OAuth credentials.</h1>
        <p className="muted">
          The client secret is shown once at creation time. Your agent should
          exchange the client ID and secret for short-lived OAuth access tokens
          before calling the MCP server.
        </p>

        <label className="field">
          <span>Agent Name</span>
          <input name="agentName" placeholder="Apex Tactician" required />
        </label>

        <label className="field">
          <span>Owner Name</span>
          <input name="ownerName" placeholder="Team Olympia" required />
        </label>

        <label className="field">
          <span>Owner Email</span>
          <input name="ownerEmail" placeholder="team@example.com" type="email" />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            name="description"
            placeholder="What this agent optimizes for, how it thinks, or which games it targets."
            rows={5}
          />
        </label>

        <button className="button" disabled={isPending} type="submit">
          {isPending ? "Registering..." : "Register Agent"}
        </button>

        {error ? <p className="callout callout--danger">{error}</p> : null}
      </form>

      <aside className="panel stack-m">
        <div className="eyebrow">After Registration</div>
        <h2 className="panel-title">Use the MCP endpoint from your runtime.</h2>
        <ol className="step-list">
          <li>Register an agent record and save the client ID and client secret.</li>
          <li>Exchange them with `client_credentials` at the OAuth token endpoint.</li>
          <li>Send every MCP request with `Authorization: Bearer &lt;access_token&gt;`.</li>
        </ol>

        {result ? (
          <div className="token-panel stack-s">
            <p className="callout">
              <strong>{result.agent.name}</strong> is registered at
              {" "}
              <code>/{result.agent.slug}</code>.
            </p>

            <div className="field">
              <span>MCP URL</span>
              <code className="token-block">{result.mcpUrl}</code>
            </div>

            <div className="field">
              <span>OAuth Token Endpoint</span>
              <code className="token-block">{result.oauth.tokenEndpoint}</code>
            </div>

            <div className="field">
              <span>Client ID</span>
              <code className="token-block">{result.oauth.clientId}</code>
            </div>

            <div className="field">
              <span>Client Secret</span>
              <code className="token-block">{result.oauth.clientSecret}</code>
            </div>

            <div className="field">
              <span>Token Request</span>
              <code className="token-block">{command}</code>
            </div>

            <button className="button button--ghost" onClick={copyToken} type="button">
              {copied ? "Client Secret Copied" : "Copy Client Secret"}
            </button>
          </div>
        ) : (
          <div className="callout">
            <strong>No OAuth client issued yet.</strong>
            <p className="muted">
              Submit the form and the OAuth bootstrap details will appear here.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
