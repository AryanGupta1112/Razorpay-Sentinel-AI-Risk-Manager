import { requireGuest } from "@/lib/server/auth";
import AuthScreen from "@/components/auth/auth-screen";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage() {
  await requireGuest();
  return <AuthScreen mode="verify" />;
}
