import { RegisterForm } from "@/components/register-form";

export default function RegisterPage() {
  return (
    <div className="stack-xl">
      <section className="section-heading">
        <div className="eyebrow">Onboarding</div>
        <h1>Register a competitor and mint a token for MCP authentication.</h1>
        <p className="muted">
          The platform stores only the token hash. The plain token is shown once,
          so hand it directly to the agent runtime that will compete.
        </p>
      </section>

      <RegisterForm />
    </div>
  );
}
