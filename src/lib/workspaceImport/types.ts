export type WorkspaceMimeType =
  | 'application/vnd.google-apps.spreadsheet'
  | 'application/vnd.google-apps.document';

export type ExportMimeType =
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'text/markdown';

export type WorkspaceImportAdapter = {
  workspaceMimeType: WorkspaceMimeType;
  exportMimeType: ExportMimeType;
  fileExtension: '.xlsx' | '.md';
  contentType: string;
  toNormalizedContent: (bytes: Buffer) => string | Promise<string>;
  toCuratorInput?: (args: {
    fileName: string;
    bytes: Buffer;
    normalizedContent: string;
  }) =>
    | { content: string; inputMode: 'full_text' | 'table_manifest' }
    | Promise<{ content: string; inputMode: 'full_text' | 'table_manifest' }>;
};

export type WorkspaceSnapshotMetadata = {
  fileId: string;
  name: string;
  mimeType: WorkspaceMimeType;
  webViewLink?: string;
  modifiedTime?: string;
};

export type WorkspaceSnapshot = {
  metadata: WorkspaceSnapshotMetadata;
  exportBuffer: Buffer;
  exportedAt: string;
};
