import * as React from 'react';
import { Label as LabelPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

const LabelRoot = LabelPrimitive.Root;

const Label = React.forwardRef<
  React.ElementRef<typeof LabelRoot>,
  React.ComponentPropsWithoutRef<typeof LabelRoot>
>(({ className, ...props }, ref) => (
  <LabelRoot
    ref={ref}
    className={cn(
      'mb-1.5 block text-xs font-medium leading-none tracking-wide text-neutral-600 peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className,
    )}
    {...props}
  />
));
Label.displayName = 'Label';

export { Label };
