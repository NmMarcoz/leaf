import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 transition-colors",
  {
    // The v2 status chip's colours: warning = missing, info = generated,
    // success = delivered, destructive = failed, secondary = complete.
    variants: {
      variant: {
        default: "border-transparent bg-sunken text-text-secondary",
        secondary: "border-transparent bg-sunken text-text-secondary",
        outline: "border-line text-text-secondary",
        info: "border-transparent bg-info-soft text-info",
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        destructive: "border-transparent bg-danger-soft text-danger",
        deliver: "border-transparent bg-deliver-soft text-deliver",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
