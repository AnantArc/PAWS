import { redirect } from "next/navigation";
import { readSessionFromCookies } from "@/lib/auth";
import { ReplayClient } from "@/components/replay/replay-client";

export const dynamic = "force-dynamic";

export default function ReplayPage() {
  const user = readSessionFromCookies();
  if (!user) redirect("/login?next=/replay");
  return <ReplayClient />;
}
