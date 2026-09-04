import { redirect } from "next/navigation";
import ConsolePage from "@/components/console-page";
import { requireSession } from "@/lib/server/auth";

export default async function AdminPage() {
  const session = await requireSession();
  if (!session.user.capabilities.canAdminUsers) {
    redirect("/overview");
  }

  return <ConsolePage initialScreen="admin" />;
}
