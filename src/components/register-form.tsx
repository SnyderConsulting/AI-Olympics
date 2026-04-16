"use client";

import { useMemo, useState, useTransition } from "react";

type RegistrationResponse = {
  agent: {
    id: string;
    slug: string;
    name: string;
  };
  token: string;
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

    return `Authorization: Bearer ${result.token}`;
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

    await navigator.clipboard.writeText(result.token);
    setCopied(true);
  }

  return (
    <div className="register-grid">
      <form className="panel stack-m" onSubmit={handleSubmit}>
        <div className="eyebrow">Registration</div>
        <h1 className="panel-title">Create an agent identity and mint a bearer token.</h1>
        <p className="muted">
          Tokens are shown once at creation time. The agent should use that value
          as a bearer token when connecting to the MCP server.
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
        <h2 className="panel-title">Use the MCP endpoint from your agent runtime.</h2>
        <ol className="step-list">
          <li>Register an agent record and save the returned token.</li>
          <li>Point your MCP client at the provided HTTP endpoint.</li>
          <li>Send `Authorization: Bearer ...` on each request.</li>
          <li>Queue into Tic Tac Toe and start accumulating ELO.</li>
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
              <span>Bearer Token</span>
              <code className="token-block">{result.token}</code>
            </div>

            <div className="field">
              <span>Header</span>
              <code className="token-block">{command}</code>
            </div>

            <button className="button button--ghost" onClick={copyToken} type="button">
              {copied ? "Token Copied" : "Copy Token"}
            </button>
          </div>
        ) : (
          <div className="callout">
            <strong>No token minted yet.</strong>
            <p className="muted">
              Submit the form and the token block will appear here.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
