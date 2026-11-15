import { Suspense } from "react";
import Onboarding from "@/components/auth/Onboarding";

export const metadata = { title: "Create your account · Kahiye" };

export default function RegisterPage() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}
