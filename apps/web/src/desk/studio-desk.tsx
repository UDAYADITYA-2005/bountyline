import { AgStudio, AgStudioProvider, createWidgets } from 'ag-studio-react';
import { useEffect, useMemo, useRef } from 'react';
import { createDeskSources } from './data-sources';
import { onDeskChanged } from './desk-events';
import { INITIAL_DESK_STATE } from './initial-state';
import { createDeskTheme } from './theme';
import { evidenceWidget } from './widgets/evidence-widget';
import { reviewQueueWidget } from './widgets/review-queue-widget';
import type { DeskRegistry } from './widgets/widget-types';

const LICENSE_KEY: string = import.meta.env.VITE_AG_STUDIO_LICENSE_KEY ?? '';
const RELOAD_MS = 15_000;

/** The AG Studio dashboard. Reloads its data after every manager action and every 15 s. */
export function StudioDesk({ mode }: { mode: 'view' | 'edit' }) {
  const apiRef = useRef<{ reload(): void } | null>(null);
  const version = useRef(1);

  const data = useMemo(() => ({ sources: createDeskSources(() => version.current) }), []);
  const widgets = useMemo(
    () =>
      createWidgets<DeskRegistry>({
        additionalTypes: [evidenceWidget, reviewQueueWidget],
        menu: [
          { label: 'Bountyline', widgetIds: ['bountyline-evidence', 'bountyline-review-queue'] },
        ],
      }),
    [],
  );
  const theme = useMemo(() => createDeskTheme(), []);

  useEffect(() => {
    const reload = (): void => {
      version.current += 1;
      apiRef.current?.reload();
    };
    const off = onDeskChanged(reload);
    const timer = setInterval(reload, RELOAD_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);

  return (
    <AgStudioProvider licenseKey={LICENSE_KEY || undefined}>
      <div className="h-[calc(100vh-7.5rem)] min-h-[640px] w-full">
        <AgStudio<DeskRegistry>
          data={data}
          widgets={widgets}
          theme={theme}
          mode={mode}
          initialState={INITIAL_DESK_STATE}
          onApiReady={(e) => {
            apiRef.current = e.api;
          }}
        />
      </div>
    </AgStudioProvider>
  );
}
