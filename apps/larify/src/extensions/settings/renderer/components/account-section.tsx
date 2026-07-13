import { Button } from "@renderer/components/ui/button"

export function AccountSection(): React.JSX.Element {
  return (
    <section className="space-y-4">
      <div>
        <div className="text-sm font-medium">徐海林</div>
        <div className="text-xs text-muted-foreground">免费版</div>
      </div>
      <Button variant="outline" size="sm">
        退出登录
      </Button>
    </section>
  )
}
