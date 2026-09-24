import { Mail, KeyRound, Loader2 } from "lucide-react";
import { EMAIL_OTP_LENGTH, type OtpStep } from "@jamspot/shared";

/**
 * Presentational half of the sign-in flow: a pure function of its props, with
 * no hooks and no Supabase access.
 *
 * Split out from SignInPanel so it can be rendered with
 * `renderToStaticMarkup` in tests, which is how this repo tests UI
 * (apps/web/tests/unit/ui.test.ts) — there's no jsdom or Testing Library here,
 * and a component holding useState can't be rendered that way.
 */

export type SignInFormProps = {
  step: OtpStep;
  email: string;
  code: string;
  isSubmitting: boolean;
  error: string | null;
  notice: string | null;
  onEmailChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onChangeEmail: () => void;
  onResend: () => void;
};

export default function SignInForm({
  step,
  email,
  code,
  isSubmitting,
  error,
  notice,
  onEmailChange,
  onCodeChange,
  onSubmit,
  onChangeEmail,
  onResend,
}: SignInFormProps) {
  const fieldClass =
    "flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full";
  const wrapClass =
    "flex items-center gap-2 bg-muted rounded-lg px-3 py-2.5 border border-border focus-within:border-primary/50 transition-colors";

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {step === "email" ? (
        <div className="space-y-2">
          <label
            htmlFor="auth-email"
            className="block text-xs uppercase text-muted-foreground"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Email
          </label>
          <div className={wrapClass}>
            <Mail size={15} className="text-muted-foreground shrink-0" />
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              className={fieldClass}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            We&apos;ll email you a code with {EMAIL_OTP_LENGTH} digits. No
            password needed.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <label
            htmlFor="auth-code"
            className="block text-xs uppercase text-muted-foreground"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {EMAIL_OTP_LENGTH}-digit code
          </label>
          <div className={wrapClass}>
            <KeyRound size={15} className="text-muted-foreground shrink-0" />
            <input
              id="auth-code"
              name="code"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={EMAIL_OTP_LENGTH}
              placeholder={"0".repeat(EMAIL_OTP_LENGTH)}
              value={code}
              onChange={(event) => onCodeChange(event.target.value)}
              className={`${fieldClass} tracking-[0.3em]`}
              style={{ fontFamily: "'DM Mono', monospace" }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Sent to <span className="text-foreground">{email}</span>.{" "}
            <button
              type="button"
              onClick={onChangeEmail}
              className="text-primary hover:underline cursor-pointer"
            >
              Use a different email
            </button>
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {notice && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {isSubmitting && <Loader2 size={16} className="animate-spin" />}
        {step === "email" ? "Email me a code" : "Verify and sign in"}
      </button>

      {step === "code" && (
        <button
          type="button"
          onClick={onResend}
          disabled={isSubmitting}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
        >
          Resend code
        </button>
      )}
    </form>
  );
}
