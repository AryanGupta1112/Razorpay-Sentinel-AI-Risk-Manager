import { requireGuest } from "@/lib/server/auth";
import AuthScreen from "@/components/auth/auth-screen";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  await requireGuest();
  return <AuthScreen mode="forgot" />;
}
