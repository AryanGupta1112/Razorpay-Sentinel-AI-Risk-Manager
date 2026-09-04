import ConsoleApp from "@/components/console-app";
import { PageTransition } from "@/components/motion/page-transition";
import { ConsoleScreen } from "@/lib/console-adapters";
import { requireSession } from "@/lib/server/auth";
import { getConsoleBootstrap } from "@/lib/server/ops-service";
import { areOperationsHalted } from "@/lib/server/operations-control";
import { scopeConsoleData } from "@/lib/server/console-access";
import { canViewScreen } from "@/lib/authorization";
import { redirect } from "next/navigation";

export default async function ConsolePage({
  initialScreen,
}: {
  initialScreen: ConsoleScreen;
}) {
  const session = await requireSession();
  if (!canViewScreen(session.user.role, initialScreen)) {
    redirect("/overview");
  }
  const initialOperationsMode = (await areOperationsHalted()) ? "halted" : "running";
  const { data } = await getConsoleBootstrap();
  const scopedData = scopeConsoleData(data, session.user);

  return (
    <PageTransition>
      <div className="h-dvh overflow-hidden">
        <ConsoleApp
          initialScreen={initialScreen}
          initialOperationsMode={initialOperationsMode}
          data={scopedData}
          viewer={session.user}
        />
      </div>
    </PageTransition>
  );
}
