import { redirect } from "next/navigation";

export default function AuthIndexRedirectPage() {
  redirect("/login");
}
