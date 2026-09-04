import { redirect } from "next/navigation";

export default async function AuthVerifyRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
  }

  redirect(query.size > 0 ? `/verify-email?${query.toString()}` : "/verify-email");
}
