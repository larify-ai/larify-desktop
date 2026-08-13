export interface FileInfo {
  isLeaf: boolean
  key: string
  title: string
}

export interface DirectoryListing {
  entries: FileInfo[]
  root: string
}
