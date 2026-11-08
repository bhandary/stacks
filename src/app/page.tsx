import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Library } from "@/components/library";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <Library
      account={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      }}
    />
  );
}
