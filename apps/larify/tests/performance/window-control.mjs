import { execFileSync } from 'node:child_process'

export function createWindowController(port = process.env.LARIFY_CDP_PORT ?? '9222') {
  if (process.platform !== 'win32') throw new Error('Window performance tests require Windows.')
  const listener = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .find((line) => line.includes(`127.0.0.1:${port}`) && line.includes('LISTENING'))
  const processId = listener?.trim().split(/\s+/).at(-1)
  if (!processId) throw new Error(`CDP listener process not found on port ${port}.`)

  return (command) => {
    const showCommand = command === 'native' || command === 'maximize' ? 3 : 9
    const move =
      command === 'normal'
        ? '[NativeWindow]::SetWindowPos($handle,[IntPtr]::Zero,80,80,1600,900,0x0040) | Out-Null'
        : command === 'pseudo'
          ? '$area=New-Object NativeWindow+RECT; [NativeWindow]::SystemParametersInfo(48,0,[ref]$area,0) | Out-Null; [NativeWindow]::SetWindowPos($handle,[IntPtr]::Zero,$area.Left,$area.Top,$area.Right-$area.Left,$area.Bottom-$area.Top,0x0040) | Out-Null'
          : ''
    const script = `Add-Type 'using System; using System.Runtime.InteropServices; public static class NativeWindow { [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; } [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd,int nCmdShow); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd,IntPtr after,int x,int y,int cx,int cy,uint flags); [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action,uint param,ref RECT rect,uint update); }'; $handle=(Get-Process -Id ${processId}).MainWindowHandle; [NativeWindow]::ShowWindowAsync($handle,${showCommand}) | Out-Null; ${move}; [NativeWindow]::SetForegroundWindow($handle) | Out-Null`
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  }
}
