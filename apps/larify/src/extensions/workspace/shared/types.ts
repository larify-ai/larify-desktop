export interface FileNode {
  isLeaf: boolean
  key: string
  title: string
}

export interface DirectoryListing {
  entries: FileNode[]
  root: string
}

export interface FileDescriptor {
  binary: boolean
  mime: string
  path: string
}
