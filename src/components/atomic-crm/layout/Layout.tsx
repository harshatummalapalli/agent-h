import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { Skeleton } from "@/components/ui/skeleton";

import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { AppShell } from "./AppShell";

export const Layout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  return (
    <>
      <AppShell>
        <main
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
          id="main-content"
        >
          <ErrorBoundary FallbackComponent={Error}>
            <Suspense
              fallback={<Skeleton className="h-12 w-12 rounded-full m-6" />}
            >
              {children}
            </Suspense>
          </ErrorBoundary>
        </main>
      </AppShell>
      <Notification />
    </>
  );
};
