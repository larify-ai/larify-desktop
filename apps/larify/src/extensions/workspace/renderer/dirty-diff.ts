import { getService } from '@codingame/monaco-vscode-api/services'
import type { ICodeEditor } from '@codingame/monaco-vscode-api/vscode/vs/editor/browser/editorBrowser'
import { ICodeEditorService } from '@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/codeEditorService.service'
import { Range } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/core/range'
import {
  OverviewRulerLane,
  type IModelDeltaDecoration
} from '@codingame/monaco-vscode-api/vscode/vs/editor/common/model'
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle'
import { IQuickDiffModelService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/browser/quickDiffModel.service'
import {
  ChangeType,
  type QuickDiffChange
} from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/quickDiff'

const classNames = {
  [ChangeType.Add]: 'workspace-dirty-diff-added',
  [ChangeType.Modify]: 'workspace-dirty-diff-modified',
  [ChangeType.Delete]: 'workspace-dirty-diff-deleted'
}

const overviewColors = {
  [ChangeType.Add]: { id: 'editorOverviewRuler.addedForeground' },
  [ChangeType.Modify]: { id: 'editorOverviewRuler.addedForeground' },
  [ChangeType.Delete]: { id: 'editorOverviewRuler.deletedForeground' }
}

const getChangeType = (change: QuickDiffChange['change']): ChangeType => {
  if (change.originalEndLineNumber === 0) return ChangeType.Add
  if (change.modifiedEndLineNumber === 0) return ChangeType.Delete
  return ChangeType.Modify
}

const createDecorations = (changes: QuickDiffChange[]): IModelDeltaDecoration[] =>
  changes.map(({ change }) => {
    const line = Math.max(1, change.modifiedStartLineNumber)
    const endLine = Math.max(line, change.modifiedEndLineNumber)
    const type = getChangeType(change)
    return {
      range: new Range(line, 1, endLine, 1),
      options: {
        description: 'workspace-dirty-diff',
        isWholeLine: true,
        linesDecorationsClassName: classNames[type],
        overviewRuler: {
          color: overviewColors[type],
          position: OverviewRulerLane.Right
        }
      }
    }
  })

class DirtyDiffController implements IDisposable {
  private modelReference: ReturnType<IQuickDiffModelService['createQuickDiffModelReference']>
  private modelListener: IDisposable | undefined
  private readonly editorListener: IDisposable
  private readonly collection

  constructor(
    private readonly editor: ICodeEditor,
    private readonly quickDiffModels: IQuickDiffModelService
  ) {
    this.collection = editor.createDecorationsCollection()
    this.editorListener = editor.onDidChangeModel(() => this.attach())
    this.attach()
  }

  dispose(): void {
    this.editorListener.dispose()
    this.detach()
    this.collection.clear()
  }

  private attach(): void {
    this.detach()
    const model = this.editor.getModel()
    if (!model || model.uri.scheme !== 'file') return
    this.modelReference = this.quickDiffModels.createQuickDiffModelReference(model.uri)
    if (!this.modelReference) {
      queueMicrotask(() => {
        if (this.editor.getModel() === model && !this.modelReference) this.attach()
      })
      return
    }
    const update = (): void =>
      this.collection.set(createDecorations(this.modelReference?.object.changes ?? []))
    this.modelListener = this.modelReference.object.onDidChange(update)
    update()
  }

  private detach(): void {
    this.modelListener?.dispose()
    this.modelReference?.dispose()
    this.modelListener = undefined
    this.modelReference = undefined
    this.collection.clear()
  }
}

export async function enableDirtyDiff(): Promise<() => void> {
  const [editors, quickDiffModels] = await Promise.all([
    getService(ICodeEditorService),
    getService(IQuickDiffModelService)
  ])
  const controllers = new Map<ICodeEditor, DirtyDiffController>()
  const add = (editor: ICodeEditor): void => {
    controllers.set(editor, new DirtyDiffController(editor, quickDiffModels))
  }
  const remove = (editor: ICodeEditor): void => {
    controllers.get(editor)?.dispose()
    controllers.delete(editor)
  }
  editors.listCodeEditors().forEach(add)
  const addListener = editors.onCodeEditorAdd(add)
  const removeListener = editors.onCodeEditorRemove(remove)
  return () => {
    addListener.dispose()
    removeListener.dispose()
    controllers.forEach((controller) => controller.dispose())
    controllers.clear()
  }
}
