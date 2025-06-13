
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton-glass", className)} // Applied new glass skeleton class
      {...props}
    />
  )
}

export { Skeleton }

    