import { verifyFieldToken, signFieldToken } from "@/lib/auth";
import { FieldView } from "@/components/field/field-view";

export const dynamic = "force-dynamic";

export default function FieldPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = searchParams.token;
  const claim = token ? verifyFieldToken(token) : null;
  const activeToken = claim && token ? token : signFieldToken("demo-mission");
  return <FieldView token={activeToken} />;
}
