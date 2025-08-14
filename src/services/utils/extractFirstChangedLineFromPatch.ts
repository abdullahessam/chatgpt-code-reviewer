import parsePatchForChanges from './patchParser';

const extractFirstChangedLineFromPatch = (patch: string): number => {
  const patchInfo = parsePatchForChanges(patch);
  return patchInfo.firstChangedLine;
};

export default extractFirstChangedLineFromPatch;
