import { AiIndicator } from "../../components/product/ai-indicator";
import { SystemHealthCard } from "../../components/system/system-health-card";
import { Card } from "../../components/ui/card";
import { EmptyState } from "../../components/ui/empty-state";
import { PageHeader } from "../../components/ui/page-header";

export default function CommandCenterPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Command Center" description="کارهای نیازمند توجه، فعالیت‌های AI و تصمیم‌های در انتظار بررسی در اینجا جمع می‌شوند." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <div className="text-xs text-[var(--muted)]">نیازمند توجه</div>
          <div className="mt-2 text-lg font-bold">هنوز داده‌ای وجود ندارد</div>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-2"><span className="text-xs text-[var(--muted)]">فعالیت AI</span><AiIndicator /></div>
          <div className="mt-2 text-lg font-bold">Gateway آماده اتصال است</div>
        </Card>
        <SystemHealthCard />
      </div>
      <EmptyState title="اولین موقعیت شغلی را ایجاد کنید" description="Job Workspace در milestone بعدی به این shell متصل می‌شود." />
    </div>
  );
}
