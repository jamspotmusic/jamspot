"use client";

import { useState } from "react";
import { normalizeOtp, type OtpStep } from "@jamspot/shared";

import SignInForm from "@/components/SignInForm";
import { useAuth } from "@/components/AuthProvider";

/**
 * Stateful container for the two-step OTP flow. Holds the form state and
 * drives AuthProvider; SignInForm renders it.
 */
export default function SignInPanel() {
  const { requestCode, verifyCode } = useAuth();

  const [step, setStep] = useState<OtpStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const send = async () => {
    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    const result = await requestCode(email);

    if (result.ok) {
      setStep("code");
      setNotice("Check your inbox — the code expires shortly.");
    } else {
      setError(result.message);
    }
    setIsSubmitting(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (step === "email") {
      await send();
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    const result = await verifyCode(email, code);

    // On success nothing is reset here: AuthProvider's onAuthStateChange
    // flips the app to its authenticated state and this panel unmounts.
    if (!result.ok) {
      setError(result.message);
      setIsSubmitting(false);
    }
  };

  const handleChangeEmail = () => {
    setStep("email");
    setCode("");
    setError(null);
    setNotice(null);
  };

  return (
    <SignInForm
      step={step}
      email={email}
      code={code}
      isSubmitting={isSubmitting}
      error={error}
      notice={notice}
      onEmailChange={setEmail}
      onCodeChange={(value) => setCode(normalizeOtp(value))}
      onSubmit={handleSubmit}
      onChangeEmail={handleChangeEmail}
      onResend={send}
    />
  );
}
