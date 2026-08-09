import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { downloadRuntimeFile, type RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'

type RemoteDownloadEntry = {
  name: string
  path: string
  isDirectory: boolean
}

function getLocalDownloadName(destinationPath: string, platform: NodeJS.Platform): string {
  const lastSeparatorIndex =
    platform === 'win32'
      ? Math.max(destinationPath.lastIndexOf('/'), destinationPath.lastIndexOf('\\'))
      : destinationPath.lastIndexOf('/')
  return destinationPath.slice(lastSeparatorIndex + 1)
}

export async function downloadRemoteFile(
  entry: RemoteDownloadEntry,
  connectionIdOrRuntimeContext: string | RuntimeFileOperationArgs
): Promise<void> {
  try {
    const result =
      typeof connectionIdOrRuntimeContext === 'string'
        ? entry.isDirectory
          ? await window.api.fs.downloadFolder({
              dirPath: entry.path,
              connectionId: connectionIdOrRuntimeContext
            })
          : await window.api.fs.downloadFile({
              filePath: entry.path,
              connectionId: connectionIdOrRuntimeContext
            })
        : await downloadRuntimeFile(connectionIdOrRuntimeContext, entry.path, entry.name)
    if (result.canceled) {
      return
    }
    // Why: POSIX permits backslashes in saved names; only Windows treats them as separators.
    const savedName = getLocalDownloadName(
      result.destinationPath,
      window.api.platform.get().platform
    )
    toast.success(
      entry.isDirectory
        ? translate(
            'auto.components.right.sidebar.FileExplorerRow.a4029c996b',
            "Downloaded folder '{{value0}}'",
            { value0: savedName }
          )
        : translate(
            'auto.components.right.sidebar.FileExplorerRow.bce4d4e44f',
            "Downloaded '{{value0}}'",
            { value0: savedName }
          ),
      {
        action: {
          label: translate('auto.components.right.sidebar.FileExplorerRow.1a3df04ae1', 'Open'),
          onClick: () => {
            void window.api.shell.openPath(result.destinationPath)
          }
        }
      }
    )
  } catch (error) {
    toast.error(
      extractIpcErrorMessage(
        error,
        entry.isDirectory
          ? translate(
              'auto.components.right.sidebar.FileExplorerRow.f729bcd97d',
              "Failed to download folder '{{value0}}'.",
              { value0: entry.name }
            )
          : translate(
              'auto.components.right.sidebar.FileExplorerRow.b3e288bf41',
              "Failed to download '{{value0}}'.",
              { value0: entry.name }
            )
      )
    )
  }
}
