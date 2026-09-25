import { zodResolver } from "@hookform/resolvers/zod";
import { requestOtpSchema, type RequestOtpResponse } from "@tatkalflow/shared";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { Banner, Button, Field, Input } from "../../components/ui";
import { ApiError, publicPost } from "../../lib/api";

type FormIn = z.input<typeof requestOtpSchema>;
type FormOut = z.output<typeof requestOtpSchema>;

export default function Login() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(requestOtpSchema) });

  const onSubmit = handleSubmit(async ({ mobile }) => {
    setError(null);
    try {
      const res = await publicPost<RequestOtpResponse>("/api/auth/otp/request", { mobile });
      navigate("/login/verify", { state: { ...res, mobile, from } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send the code. Please try again.");
    }
  });

  return (
    <section className="animate-rise flex flex-1 flex-col gap-6">
      <Link to="/welcome" className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-muted">
        <ArrowLeft aria-hidden className="size-4" /> Back
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Your mobile number</h1>
        <p className="mt-1 text-muted">We'll send a 6-digit code to verify it. This is your TatkalFlow sign-in, not your IRCTC login.</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col gap-5">
        <Field label="Mobile number" htmlFor="mobile" error={formState.errors.mobile?.message} hint="Indian mobile numbers only">
          <div className="flex gap-2">
            <span className="grid min-h-12 place-items-center rounded-xl border border-border bg-surface-2 px-3 font-medium" aria-hidden>
              +91
            </span>
            <Input
              id="mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98200 12345"
              autoFocus
              invalid={Boolean(formState.errors.mobile)}
              {...register("mobile")}
            />
          </div>
        </Field>
        {error && <Banner tone="danger">{error}</Banner>}
        <Button type="submit" block loading={formState.isSubmitting} className="mt-auto">
          Send OTP
        </Button>
      </form>
    </section>
  );
}
