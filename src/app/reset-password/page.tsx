import { requireGuest } from "@/lib/server/auth";
import AuthScreen from "@/components/auth/auth-screen";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  await requireGuest();
  return <AuthScreen mode="reset" />;
}
