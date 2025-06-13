
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary/80 text-primary-foreground hover:bg-primary/90 shadow-[0_2px_10px_hsla(var(--primary-hsl),0.2),inset_0_0_5px_hsla(var(--primary-foreground-hsl),0.1)] hover:shadow-[0_4px_15px_3px_hsla(var(--primary-hsl),0.3),inset_0_0_8px_hsla(var(--primary-foreground-hsl),0.2)] active:bg-primary/70 backdrop-blur-sm",
        destructive:
          "bg-destructive/80 text-destructive-foreground hover:bg-destructive/90 shadow-[0_2px_10px_hsla(var(--destructive-hsl),0.2)] hover:shadow-[0_4px_15px_3px_hsla(var(--destructive-hsl),0.3)] backdrop-blur-sm",
        outline:
          "border border-input/50 bg-background/10 backdrop-blur-sm hover:bg-accent/30 hover:text-accent-foreground hover:shadow-[0_0_10px_2px_hsla(var(--accent-hsl),0.2)]",
        secondary:
          "bg-secondary/70 text-secondary-foreground hover:bg-secondary/80 shadow-[0_2px_8px_hsla(var(--secondary-hsl),0.2)] hover:shadow-[0_3px_12px_2px_hsla(var(--secondary-hsl),0.3)] backdrop-blur-sm",
        ghost: "hover:bg-accent/30 hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline hover:text-primary/80",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

    