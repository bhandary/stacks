import { redirect } from "next/navigation";
import { auth, authRuntime, signIn } from "@/auth";
import { isTestOidcAllowed } from "@/lib/auth-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

async function continueWithGoogle() {
  "use server";
  if (!authRuntime().googleEnabled) return;
  await signIn("google", { redirectTo: "/" });
}

async function continueWithTest(formData: FormData) {
  "use server";
  if (!isTestOidcAllowed(process.env)) return;
  const subject = formData.get("subject");
  if (subject !== "alice" && subject !== "bob") return;
  await signIn("stacks-test-oidc", { redirectTo: "/" }, { login_hint: subject });
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) redirect("/");
  const params = await searchParams;
  const runtime = authRuntime();
  const testOidc = isTestOidcAllowed(process.env);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-[430px] flex-1 flex-col justify-center px-5 py-10">
      <p className="text-[11px] font-medium tracking-[0.16em] text-stone-400 uppercase">
        Personal shelf
      </p>
      <h1 className="mt-3 font-heading text-[2.7rem] leading-none tracking-tight">Stacks</h1>
      <p className="mt-4 text-sm leading-6 text-stone-600">
        Sign in with Google. Each account keeps its own books, notes, and backups.
      </p>

      {params.error ? (
        <p
          className="mt-5 rounded-xl bg-white px-3 py-3 text-sm text-stone-700 ring-1 ring-black/5"
          data-testid="login-error"
        >
          Sign-in did not finish. No shelf was opened.
        </p>
      ) : null}

      {runtime.googleEnabled ? (
        <form action={continueWithGoogle} className="mt-8">
          <button
            type="submit"
            data-testid="continue-google"
            className="flex h-12 w-full items-center justify-center gap-3 rounded-full bg-white text-sm font-medium text-stone-800 shadow-sm ring-1 ring-black/10"
          >
            <GoogleMark />
            Continue with Google
          </button>
        </form>
      ) : (
        <div
          className="mt-8 rounded-2xl bg-white px-4 py-4 text-sm leading-6 text-stone-600 shadow-sm ring-1 ring-black/5"
          data-testid="auth-unconfigured"
        >
          <p className="font-medium text-stone-800">Google sign-in is not configured.</p>
          <p className="mt-2">
            Set AUTH_URL, AUTH_SECRET, AUTH_GOOGLE_ID, and AUTH_GOOGLE_SECRET. Until those are
            present, Stacks stays signed out and does not open a shelf.
          </p>
        </div>
      )}

      <p className="mt-4 text-xs leading-5 text-stone-500">
        Google is asked only for OpenID, email, and profile. Stacks does not read Gmail.
      </p>

      {testOidc ? (
        <section className="mt-8 rounded-2xl border border-dashed border-stone-300 px-4 py-4">
          <p className="text-xs leading-5 text-stone-500" data-testid="test-oidc-note">
            Local test identity. This is a fixture on this machine, not Google, and it is absent
            in production.
          </p>
          <form action={continueWithTest} className="mt-3 grid gap-2">
            <button
              type="submit"
              name="subject"
              value="alice"
              data-testid="continue-test-alice"
              className="h-10 rounded-full bg-stone-900 text-sm text-white"
            >
              Continue with test account A
            </button>
            <button
              type="submit"
              name="subject"
              value="bob"
              data-testid="continue-test-bob"
              className="h-10 rounded-full bg-white text-sm text-stone-800 ring-1 ring-black/10"
            >
              Continue with test account B
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
