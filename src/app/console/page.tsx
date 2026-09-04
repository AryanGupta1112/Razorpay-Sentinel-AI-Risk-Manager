import { redirect } from "next/navigation";
import { requireSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function ConsoleRedirectPage() {
  await requireSession();
  redirect("/overview");
}
