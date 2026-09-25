import { redirect } from "next/navigation";
import { readSessionFromCookies } from "@/lib/auth";
import { SettingsClient } from "@/components/settings/settings-client";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const user = readSessionFromCookies();
  if (!user) redirect("/login?next=/settings");
  return <SettingsClient user={user} />;
}
