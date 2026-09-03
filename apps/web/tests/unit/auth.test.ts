import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EMAIL_OTP_LENGTH,
  describeAuthError,
  isValidEmail,
  isValidOtp,
  normalizeEmail,
  normalizeOtp,
  requestEmailOtp,
  signOut,
  verifyEmailOtp,
  type AuthErrorLike,
  type OtpAuthClient,
} from "@jamspot/shared";
import SignInForm, { type SignInFormProps } from "../../components/SignInForm";

/**
 * The OTP flow is exercised against a fake `auth` object rather than the real
 * Supabase client, so no test ever sends an email or touches the network.
 * `OtpAuthClient` is the structural contract the shared helpers accept, which
 * is what makes that substitution type-safe.
 */

type Calls = {
  signInWithOtp: { email: string }[];
  verifyOtp: { email: string; token: string; type: string }[];
  signOut: number;
};

function fakeAuth(
  overrides: {
    signInError?: AuthErrorLike | null;
    verifyError?: AuthErrorLike | null;
    verifySession?: unknown;
    signOutError?: AuthErrorLike | null;
    throwOn?: "signInWithOtp" | "verifyOtp" | "signOut";
    thrown?: unknown;
  } = {},
): { auth: OtpAuthClient; calls: Calls } {
  const calls: Calls = { signInWithOtp: [], verifyOtp: [], signOut: 0 };

  const auth: OtpAuthClient = {
    async signInWithOtp(credentials) {
      calls.signInWithOtp.push({ email: credentials.email });
      if (overrides.throwOn === "signInWithOtp") throw overrides.thrown;
      return { error: overrides.signInError ?? null };
    },
    async verifyOtp(params) {
      calls.verifyOtp.push(params);
      if (overrides.throwOn === "verifyOtp") throw overrides.thrown;
      return {
        data: {
          session:
            overrides.verifySession === undefined
              ? { access_token: "token" }
              : overrides.verifySession,
          user: { id: "user-1" },
        },
        error: overrides.verifyError ?? null,
      };
    },
    async signOut() {
      calls.signOut += 1;
      if (overrides.throwOn === "signOut") throw overrides.thrown;
      return { error: overrides.signOutError ?? null };
    },
  };

  return { auth, calls };
}

// --- input helpers -------------------------------------------------------

test("email validation accepts real addresses and rejects obvious typos", () => {
  assert.ok(isValidEmail("fan@jamspot.test"));
  assert.ok(isValidEmail("  FAN@JamSpot.test  "), "trims and lowercases first");
  assert.equal(isValidEmail("fan@jamspot"), false, "no dotted domain");
  assert.equal(isValidEmail("fan.jamspot.test"), false, "no @");
  assert.equal(isValidEmail(""), false);
  assert.equal(normalizeEmail("  FAN@JamSpot.test "), "fan@jamspot.test");
});

test("OTP normalization strips separators and caps at the code length", () => {
  assert.equal(normalizeOtp("1234 5678"), "12345678");
  assert.equal(normalizeOtp("1234-5678"), "12345678");
  assert.equal(normalizeOtp("123456789999"), "12345678");
  assert.ok(isValidOtp("12345678"));
  assert.equal(isValidOtp("1234567"), false, "seven digits is short");
  assert.equal(EMAIL_OTP_LENGTH, 8);
});

// --- requesting a code ---------------------------------------------------

test("submitting an email invokes the OTP flow with the normalized address", async () => {
  const { auth, calls } = fakeAuth();

  const result = await requestEmailOtp(auth, "  Fan@JamSpot.test ");

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.signInWithOtp.length, 1);
  assert.equal(calls.signInWithOtp[0].email, "fan@jamspot.test");
});

test("an invalid email is rejected without any network call", async () => {
  const { auth, calls } = fakeAuth();

  const result = await requestEmailOtp(auth, "not-an-email");

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : "", /valid email address/i);
  assert.equal(calls.signInWithOtp.length, 0, "never reaches Supabase");
});

test("a failed OTP send surfaces a friendly message", async () => {
  const { auth } = fakeAuth({
    signInError: { message: "Error sending confirmation email", status: 500 },
  });

  const result = await requestEmailOtp(auth, "fan@jamspot.test");

  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.message.length > 0);
});

test("rate limiting is reported as something the user can wait out", async () => {
  const { auth } = fakeAuth({
    signInError: {
      message: "email rate limit exceeded",
      code: "over_email_send_rate_limit",
      status: 429,
    },
  });

  const result = await requestEmailOtp(auth, "fan@jamspot.test");

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : "", /too many attempts/i);
});

// --- verifying a code ----------------------------------------------------

test("successful verification produces an authenticated result", async () => {
  const { auth, calls } = fakeAuth();

  const result = await verifyEmailOtp(auth, "fan@jamspot.test", "1234 5678");

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.verifyOtp.length, 1);
  assert.deepEqual(calls.verifyOtp[0], {
    email: "fan@jamspot.test",
    token: "12345678",
    type: "email",
  });
});

test("an invalid OTP produces an error naming the code length", async () => {
  const { auth } = fakeAuth({
    verifyError: {
      message: "Token has expired or is invalid",
      code: "invalid_credentials",
      status: 403,
    },
  });

  const result = await verifyEmailOtp(auth, "fan@jamspot.test", "00000000");

  assert.equal(result.ok, false);
  assert.match(
    result.ok === false ? result.message : "",
    new RegExp(`${EMAIL_OTP_LENGTH} digits`),
  );
});

test("an expired OTP tells the user to request a new code", async () => {
  const { auth } = fakeAuth({
    verifyError: { message: "Token has expired", code: "otp_expired", status: 403 },
  });

  const result = await verifyEmailOtp(auth, "fan@jamspot.test", "12345678");

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : "", /expired/i);
  assert.match(result.ok === false ? result.message : "", /new one/i);
});

test("a short code is rejected before reaching Supabase", async () => {
  const { auth, calls } = fakeAuth();

  const result = await verifyEmailOtp(auth, "fan@jamspot.test", "1234");

  assert.equal(result.ok, false);
  assert.equal(calls.verifyOtp.length, 0);
});

test("a verify that returns no session is treated as a failure", async () => {
  // Supabase answering OK but issuing nothing would otherwise leave the UI
  // 'signed in' with no credentials to make requests with.
  const { auth } = fakeAuth({ verifySession: null });

  const result = await verifyEmailOtp(auth, "fan@jamspot.test", "12345678");

  assert.equal(result.ok, false);
});

test("a dropped request is reported as a network problem, not a bad code", async () => {
  const { auth } = fakeAuth({
    throwOn: "verifyOtp",
    thrown: new TypeError("Failed to fetch"),
  });

  const result = await verifyEmailOtp(auth, "fan@jamspot.test", "12345678");

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : "", /connection/i);
});

// --- signing out ---------------------------------------------------------

test("sign-out calls Supabase and reports success", async () => {
  const { auth, calls } = fakeAuth();

  const result = await signOut(auth);

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.signOut, 1);
});

test("a failing sign-out still returns a message to show", async () => {
  const { auth } = fakeAuth({ signOutError: { message: "session missing" } });

  const result = await signOut(auth);

  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.message.length > 0);
});

// --- error mapping -------------------------------------------------------

test("unknown errors fall back rather than surfacing an empty string", () => {
  assert.equal(describeAuthError(null, "fallback"), "fallback");
  assert.equal(describeAuthError({} as AuthErrorLike, "fallback"), "fallback");
  assert.equal(
    describeAuthError({ message: "Something specific" }, "fallback"),
    "Something specific",
  );
});

test("React Native's network failure wording is recognized too", () => {
  // RN reports dropped requests as "Network request failed", not "Failed to
  // fetch", so the mobile app depends on this branch.
  assert.match(
    describeAuthError({ message: "Network request failed" }),
    /connection/i,
  );
});

// --- rendering -----------------------------------------------------------

function formProps(overrides: Partial<SignInFormProps> = {}): SignInFormProps {
  return {
    step: "email",
    email: "",
    code: "",
    isSubmitting: false,
    error: null,
    notice: null,
    onEmailChange: () => {},
    onCodeChange: () => {},
    onSubmit: () => {},
    onChangeEmail: () => {},
    onResend: () => {},
    ...overrides,
  };
}

test("the form starts on the email step", () => {
  const html = renderToStaticMarkup(React.createElement(SignInForm, formProps()));

  assert.match(html, /Email me a code/);
  assert.match(html, /type="email"/);
  assert.doesNotMatch(html, /Verify and sign in/);
});

test("the form moves to the code step once a code has been sent", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      SignInForm,
      formProps({ step: "code", email: "fan@jamspot.test" }),
    ),
  );

  assert.match(html, /Verify and sign in/);
  assert.match(html, new RegExp(`${EMAIL_OTP_LENGTH}-digit code`));
  assert.match(html, /one-time-code/, "hints the OS autofill");
  assert.match(html, /fan@jamspot\.test/, "shows where the code went");
  assert.match(html, /Resend code/);
});

test("an error is rendered as an alert", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      SignInForm,
      formProps({ step: "code", error: "That code doesn't look right." }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /That code doesn&#x27;t look right\./);
});

test("the submit button is disabled while a request is in flight", () => {
  const html = renderToStaticMarkup(
    React.createElement(SignInForm, formProps({ isSubmitting: true })),
  );

  assert.match(html, /disabled=""/);
});
