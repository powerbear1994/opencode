import { type Component } from "solid-js"
import { Dialog, DialogFooter } from "@opencode-ai/ui/v2/dialog-v2"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"

interface DeleteDialogProps {
  agentName: string
  onConfirm: () => void
  loading?: boolean
}

export const DeleteAgentDialog: Component<DeleteDialogProps> = (props) => {
  const dialog = useDialog()

  return (
    <Dialog
      fit
      title="删除智能体"
      description={
        <>
          确定要删除智能体{" "}
          <span class="font-[530] text-[var(--v2-text-text-base)]">{props.agentName}</span>
          {" "}吗？此操作不可撤销。
        </>
      }
    >
      <DialogFooter>
        <Button variant="ghost" size="small" onClick={() => dialog.close()} disabled={props.loading}>
          取消
        </Button>
        <Button variant="primary" size="small" onClick={props.onConfirm} disabled={props.loading}>
          {props.loading ? "删除中..." : "确认删除"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
