import ConsoleApp from "@/components/console-app";
import { PageTransition } from "@/components/motion/page-transition";
import { ConsoleScreen } from "@/lib/console-adapters";
import { requireSession } from "@/lib/server/auth";
import { getConsoleBootstrap } from "@/lib/server/ops-service";
import { areOperationsHalted } from "@/lib/server/operations-control";

export default async function ConsolePage({
  initialScreen,
}: {
  initialScreen: ConsoleScreen;
}) {
  const session = await requireSession();
  const initialOperationsMode = (await areOperationsHalted()) ? "halted" : "running";
  const { data } = await getConsoleBootstrap();

  return (
    <PageTransition>
      <div className="h-dvh overflow-hidden">
        <ConsoleApp
          initialScreen={initialScreen}
          initialOperationsMode={initialOperationsMode}
          data={data}
          viewer={session.user}
        />
      </div>
    </PageTransition>
  );
}
