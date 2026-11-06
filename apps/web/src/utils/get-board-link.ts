export function getBoardLink({
  boardPublicId,
  isTemplate,
  visibility,
  workspaceSlug,
  boardSlug,
}: {
  boardPublicId: string;
  isTemplate: boolean;
  visibility?: string;
  workspaceSlug?: string;
  boardSlug?: string;
}): string {
  if (isTemplate) return `/templates/${boardPublicId}`;
  if (visibility === "public" && workspaceSlug && boardSlug) {
    return `/${workspaceSlug}/${boardSlug}`;
  }
  return `/boards/${boardPublicId}`;
}
