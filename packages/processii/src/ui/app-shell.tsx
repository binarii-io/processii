import { forwardRef } from 'react';
import { cn } from './cn.js';

/**
 * AppShell — layout skeleton (sidebar + topbar + content area). Local copy of
 * `ui-kit` (ADR 0006): pure presentation, the host app wires the content. ARIA landmarks
 * in place (`banner`, `complementary`, `main`) for screen-reader navigation.
 *
 * The sidebar/content separation is done with a **drop shadow** (no line): the main area is
 * raised (`z`) and casts a shadow on the menu edge (depth effect). The sidebar is
 * **collapsible** with animation via `sidebarCollapsed`.
 */
export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Sidebar (spaces). Rendered inside a `complementary` landmark. */
  sidebar?: React.ReactNode;
  /**
   * Collapses the sidebar (width → 0) with **animation**. The sidebar stays **mounted**
   * (CSS transition) but becomes inert (`aria-hidden` + `inert`) while collapsed.
   * Default: expanded.
   */
  sidebarCollapsed?: boolean;
  /** Top bar. Rendered inside a `banner` landmark. */
  topbar?: React.ReactNode;
  /** Additional classes for the `header` (e.g. `bg-transparent` to blend the topbar). */
  headerClassName?: string;
}

export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(function AppShell(
  { className, sidebar, sidebarCollapsed = false, topbar, headerClassName, children, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn('flex h-dvh w-full bg-bg text-text', className)} {...props}>
      {sidebar !== undefined && (
        <aside
          aria-label="Espaces"
          aria-hidden={sidebarCollapsed || undefined}
          inert={sidebarCollapsed}
          className={cn(
            'hidden shrink-0 flex-col overflow-hidden bg-sidebar md:flex',
            'transition-[width] duration-200 ease-out motion-reduce:transition-none',
            sidebarCollapsed ? 'w-0' : 'w-64',
          )}
        >
          {/* Frozen content width: during the animation it is **clipped** (slide), not squeezed. */}
          <div className="flex h-full w-64 flex-col">{sidebar}</div>
        </aside>
      )}
      {/* Separation by **drop shadow** (no line): the main area is raised (z) above
          the sidebar, its shadow falls on the menu edge → depth effect. */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col bg-bg shadow-[-1px_0_2px_-1px_rgb(0_0_0/0.05),-4px_0_8px_-4px_rgb(0_0_0/0.06)]">
        {topbar !== undefined && (
          <header
            className={cn(
              'flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-4',
              headerClassName,
            )}
          >
            {topbar}
          </header>
        )}
        <main className="min-h-0 flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
});
