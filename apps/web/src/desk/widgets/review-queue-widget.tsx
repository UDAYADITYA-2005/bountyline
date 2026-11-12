import { ReviewQueue } from '../review-queue';
import type { QueueWidgetDef } from './widget-types';

function ReviewQueueWidget() {
  return (
    <div className="h-full overflow-auto bg-surface text-ink">
      <ReviewQueue />
    </div>
  );
}

export const reviewQueueWidget: QueueWidgetDef = {
  id: 'bountyline-review-queue',
  label: 'Review queue',
  comp: ReviewQueueWidget,
  form: (p) => p.createDefaults({}),
  defaultSize: { width: 8, height: 30 },
  minSize: { width: 5, height: 14 },
};
