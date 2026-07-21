/**
 * Inserts a DOM comment (e.g. ` AG Grid `) before the given element, returning a cleanup that
 * removes it. Port of reactUi/reactComment.tsx `useReactCommentEffect`; call from `onSettled` so
 * the element has a parent (Solid refs fire before the template is inserted into its parent).
 */
export function insertDomComment(
  comment: string,
  eForComment: HTMLElement | undefined,
): (() => void) | undefined {
  if (!eForComment) {
    return undefined;
  }
  const eParent = eForComment.parentElement;
  if (!eParent) {
    return undefined;
  }
  const eComment = document.createComment(comment);
  eParent.insertBefore(eComment, eForComment);
  return () => {
    eComment.remove();
  };
}
