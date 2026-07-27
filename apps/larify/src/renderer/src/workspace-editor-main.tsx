import '@codingame/monaco-vscode-language-pack-zh-hans'
import './assets/main.css'
import '../../extensions/workspace/renderer/workspace.css'
import { createRoot } from 'react-dom/client'
import { WorkspaceEditorRoot } from '../../extensions/workspace/renderer/workspace-editor-root'

const element = document.getElementById('root')
if (!element) throw new Error('Workspace editor root is missing')
createRoot(element).render(<WorkspaceEditorRoot />)
