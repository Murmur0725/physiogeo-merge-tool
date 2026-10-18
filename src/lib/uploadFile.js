/** Read while the browser still has access, with a filename-specific recovery hint. */
export async function readUploadBytes(file) {
  try {
    return await file.arrayBuffer();
  } catch (cause) {
    throw new Error(`Cannot read "${file.name}". Select the file again. If it is in iCloud or another cloud folder, download it to this computer first and close any app saving changes to it.`, { cause });
  }
}

/** Detach processing and later archiving from a mutable on-disk file reference. */
export async function captureUpload(file) {
  const bytes = await readUploadBytes(file);
  return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
}
