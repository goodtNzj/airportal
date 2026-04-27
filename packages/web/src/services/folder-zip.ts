import JSZip from 'jszip';

export interface FolderEntry {
  relativePath: string;
  file: File;
}

/**
 * Walk a FileSystemDirectoryEntry recursively to collect all files.
 */
export async function readFolderEntries(
  directoryEntry: FileSystemDirectoryEntry
): Promise<FolderEntry[]> {
  const entries: FolderEntry[] = [];

  async function readEntry(entry: FileSystemEntry, parentPath = ''): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      entries.push({
        relativePath: parentPath ? `${parentPath}/${entry.name}` : entry.name,
        file,
      });
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries may not return all entries in one call, so loop
      let allEntries: FileSystemEntry[] = [];
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          dirReader.readEntries(resolve, reject);
        });
        allEntries = allEntries.concat(batch);
      } while (batch.length > 0);

      const dirPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      for (const child of allEntries) {
        await readEntry(child, dirPath);
      }
    }
  }

  await readEntry(directoryEntry);
  return entries;
}

/**
 * Create a ZIP blob from a list of folder entries.
 */
export async function createZipFromEntries(
  entries: FolderEntry[],
  folderName: string,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder(folderName)!;

  for (let i = 0; i < entries.length; i++) {
    const { relativePath, file } = entries[i];
    folder.file(relativePath, file);
    onProgress?.(Math.round(((i + 1) / entries.length) * 100));
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Creates a File from File array (fallback for browsers that don't support
 * webkitGetAsEntry / FileSystemDirectoryEntry API).
 */
export async function createZipFromFileList(
  files: FileList | File[],
  folderName: string,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const entries: FolderEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // webkitRelativePath is available when using webkitdirectory
    const relativePath = (file as any).webkitRelativePath || file.name;
    entries.push({ relativePath, file });
  }

  return createZipFromEntries(entries, folderName, onProgress);
}
