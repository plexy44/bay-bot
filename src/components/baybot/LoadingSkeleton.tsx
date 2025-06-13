import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const LoadingSkeletonCard: React.FC = () => {
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader className="p-0">
        <Skeleton className="aspect-video w-full" />
      </CardHeader>
      <CardContent className="p-4 flex-grow">
        <Skeleton className="h-6 w-3/4 mb-2" />
        <Skeleton className="h-8 w-1/2 mb-3" />
        <Skeleton className="h-4 w-full mb-1" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
      <CardFooter className="p-4 pt-0">
        <Skeleton className="h-10 w-full" />
      </CardFooter>
    </Card>
  );
};

export const ItemGridLoadingSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, index) => (
        <LoadingSkeletonCard key={index} />
      ))}
    </div>
  );
};
