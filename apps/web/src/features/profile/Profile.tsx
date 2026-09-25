import { irctcUserIdSchema, updateProfileSchema } from "@tatkalflow/shared";
import { LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Banner, Button, Card, ConfirmDialog, Field, Input, PageHeader, Segmented, Spinner, Switch } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useIrctcAccount, useMe, useRemoveIrctcAccount, useSaveIrctcAccount, useUpdateMe } from "../../lib/queries";
import { getTheme, setTheme, type ThemeChoice } from "../../lib/theme";
import { formatMobile } from "../../lib/format";
import { InstallCard } from "./InstallCard";

function ProfileDetails() {
  const me = useMe();
  const update = useUpdateMe();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  useEffect(() => {
    if (me.data) {
      setFullName(me.data.fullName ?? "");
      setEmail(me.data.email ?? "");
    }
  }, [me.data]);
  if (me.isPending) return <Spinner label="Loading profile" />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const parsed = updateProfileSchema.safeParse({ fullName: fullName.trim() || undefined, email: email.trim() || null });
    if (!parsed.success) return setMsg({ tone: "danger", text: parsed.error.issues[0]?.message ?? "Check your details" });
    try {
      await update.mutateAsync(parsed.data);
      setMsg({ tone: "success", text: "Saved." });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Couldn't save." });
    }
  }

  return (
    <Card as="section">
      <h2 className="mb-4 text-lg font-semibold">Your details</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">Mobile: {formatMobile(me.data?.mobile ?? "")}</p>
        <Field label="Name" htmlFor="pf-name">
          <Input id="pf-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email (optional)" htmlFor="pf-email" hint="For reminders by email, when enabled.">
          <Input id="pf-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <Button type="submit" variant="secondary" loading={update.isPending}>
          Save details
        </Button>
      </form>
    </Card>
  );
}

function IrctcSection() {
  const account = useIrctcAccount();
  const save = useSaveIrctcAccount();
  const remove = useRemoveIrctcAccount();
  const [userId, setUserId] = useState("");
  const [keep, setKeep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (account.data) {
      setUserId(account.data.irctcUserId ?? "");
      setKeep(account.data.keepSignedInPreference);
    }
  }, [account.data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = irctcUserIdSchema.safeParse(userId);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the User ID");
    try {
      await save.mutateAsync({ irctcUserId: parsed.data, keepSignedInPreference: keep });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    }
  }

  return (
    <Card as="section">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck aria-hidden className="size-5 text-success" /> IRCTC account
      </h2>
      <p className="mt-2 text-sm text-muted">
        TatkalFlow never asks for or stores your IRCTC password. When it's time to book, you sign in on IRCTC yourself, and complete CAPTCHA, OTP and payment there.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
        <Field label="IRCTC User ID (optional)" htmlFor="irctc-id" error={error ?? undefined} hint="Shown as a reminder when you open IRCTC.">
          <Input id="irctc-id" autoComplete="username" autoCapitalize="none" value={userId} onChange={(e) => setUserId(e.target.value)} invalid={Boolean(error)} />
        </Field>
        <Switch label="Keep me signed in where permitted" description="IRCTC may require you to authenticate again." checked={keep} onChange={setKeep} />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" loading={save.isPending} className="flex-1">
            Save
          </Button>
          {account.data?.linked && (
            <Button type="button" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function Appearance() {
  const [theme, setChoice] = useState<ThemeChoice>(getTheme);
  return (
    <Card as="section">
      <Segmented
        label="Appearance"
        name="theme"
        value={theme}
        onChange={(t) => {
          setChoice(t);
          setTheme(t);
        }}
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
    </Card>
  );
}

export default function Profile() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doSignOut(all: boolean) {
    setBusy(true);
    try {
      if (all) await api<void>("/api/auth/logout-all", { method: "POST" }).catch(() => undefined);
      await signOut();
    } finally {
      setBusy(false);
      navigate("/welcome", { replace: true });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Profile" />
      <ProfileDetails />
      <IrctcSection />
      <Appearance />
      <InstallCard />
      <Card as="section">
        <h2 className="text-lg font-semibold">About</h2>
        <p className="mt-2 text-sm text-muted">
          TatkalFlow is an independent assistant. It is not IRCTC and is not affiliated with IRCTC or Indian Railways. It helps you prepare and reminds you; it doesn't book on your behalf or guarantee availability.
        </p>
      </Card>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" onClick={() => void doSignOut(false)} loading={busy}>
          <LogOut aria-hidden className="size-5" /> Sign out
        </Button>
        <Button variant="ghost" onClick={() => setConfirmAll(true)}>
          Sign out on all devices
        </Button>
      </div>
      <ConfirmDialog
        open={confirmAll}
        title="Sign out everywhere?"
        body="You'll be signed out of TatkalFlow on every phone and browser."
        confirmLabel="Sign out everywhere"
        busy={busy}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => void doSignOut(true)}
      />
    </div>
  );
}
