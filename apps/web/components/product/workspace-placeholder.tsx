import { EmptyState } from "../ui/empty-state";
import { PageHeader } from "../ui/page-header";

export function WorkspacePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <EmptyState title="فضای کاری آماده است" description="داده و قابلیت‌های این بخش در vertical slice مربوط به خودش اضافه می‌شوند." />
    </div>
  );
}
