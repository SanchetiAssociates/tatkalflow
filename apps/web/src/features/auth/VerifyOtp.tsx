import { otpCodeSchema, type AuthTokensResponse, type RequestOtpResponse } from "@tatkalflow/shared";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { Banner, Button, Field, Input } from "../../components/ui";
import { ApiError, publicPost, session } from "../../lib/api";

type OtpState = RequestOtpResponse & { mobile: string; from?: string };

function useSecondsUntil(iso: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}

export default function VerifyOtp() {
  const navigate = useNavigate();
  const initial = useLocation().state as OtpState | null;
  const [otp, setOtp] = useState<OtpState | null>(initial);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resendIn = useSecondsUntil(otp?.resendAvailableAt ?? new Date(0).toISOString());

  if (!otp) return <Navigate to="/login" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = otpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter the 6-digit code");
      return;
    }
    setBusy(true);
    try {
      const res = await publicPost<AuthTokensResponse>("/api/auth/otp/verify", { otpSessionId: otp!.otpSessionId, code: parsed.data });
      session.acceptSignIn({ accessToken: res.accessToken, accessTokenExpiresAt: res.accessTokenExpiresAt, user: res.user });
      navigate(res.user.isNewUser ? "/onboarding/ready" : (otp!.from ?? "/"), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't verify the code. Please try again.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    try {
      const res = await publicPost<RequestOtpResponse>("/api/auth/otp/resend", { otpSessionId: otp!.otpSessionId });
      setOtp({ ...otp!, ...res });
      setInfo("A new code is on its way. Earlier codes no longer work.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resend the code.");
    }
  }

  const masked = `+91 ••••• ${otp.mobile.slice(-5)}`;
  return (
    <section className="animate-rise flex flex-1 flex-col gap-6">
      <Link to="/login" className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-muted">
        <ArrowLeft aria-hidden className="size-4" /> Change number
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Enter the code</h1>
        <p className="mt-1 text-muted">Sent by SMS to {masked}. Never share this code with anyone.</p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-5">
        <Field label="6-digit code" htmlFor="otp" error={error ?? undefined}>
          <Input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            autoFocus
            value={code}
            invalid={Boolean(error)}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="text-center text-2xl font-semibold tracking-[0.5em]"
          />
        </Field>
        {info && <Banner tone="success">{info}</Banner>}
        <Button type="button" variant="ghost" onClick={resend} disabled={resendIn > 0}>
          {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
        </Button>
        <Button type="submit" block loading={busy} disabled={code.length !== 6} className="mt-auto">
          Verify
        </Button>
      </form>
    </section>
  );
}
