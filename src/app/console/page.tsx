import { redirect } from "next/navigation";
import { readSessionFromCookies } from "@/lib/auth";
import { ConsoleClient } from "@/components/console/console-client";

export const dynamic = "force-dynamic";

export default function ConsolePage() {
  const user = readSessionFromCookies();
  if (!user) redirect("/login?next=/console");
  return <ConsoleClient user={user} />;
}
