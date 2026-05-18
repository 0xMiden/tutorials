import * as React from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';
import { Select } from 'radix-ui';
import { cn } from '@/lib/utils';

const SelectRoot = Select.Root;
const SelectGroup = Select.Group;
const SelectValue = Select.Value;
const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof Select.Trigger>,
  React.ComponentPropsWithoutRef<typeof Select.Trigger>
>(({ className, children, ...props }, ref) => (
  <Select.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-neutral-400 [&>span]:line-clamp-1',
      className,
    )}
    {...props}
  >
    {children}
    <Select.Icon asChild>
      <CaretDown className="size-4 shrink-0 text-neutral-500" weight="bold" aria-hidden />
    </Select.Icon>
  </Select.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

const SelectContent = React.forwardRef<
  React.ElementRef<typeof Select.Content>,
  React.ComponentPropsWithoutRef<typeof Select.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <Select.Portal>
    <Select.Content
      ref={ref}
      position={position}
      sideOffset={4}
      className={cn(
        'relative z-[100] max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-neutral-200 bg-white text-neutral-900 shadow-lg',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-0.5 data-[side=left]:-translate-x-0.5 data-[side=right]:translate-x-0.5 data-[side=top]:-translate-y-0.5',
        className,
      )}
      {...props}
    >
      <Select.Viewport className={cn('max-h-60 overflow-y-auto p-1')}>
        {children}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
));
SelectContent.displayName = 'SelectContent';

const SelectItem = React.forwardRef<
  React.ElementRef<typeof Select.Item>,
  React.ComponentPropsWithoutRef<typeof Select.Item>
>(({ className, children, ...props }, ref) => (
  <Select.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-md py-2 pl-2 pr-8 text-sm outline-none transition-colors focus:bg-neutral-100 focus:text-neutral-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute right-2 flex size-4 items-center justify-center">
      <Select.ItemIndicator>
        <Check className="size-4 text-primary" weight="bold" />
      </Select.ItemIndicator>
    </span>
    <Select.ItemText>{children}</Select.ItemText>
  </Select.Item>
));
SelectItem.displayName = 'SelectItem';

export { SelectRoot, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem };
