export function createRefCountedSubscription(start: () => () => void) {
  let references = 0;
  let stop: (() => void) | null = null;

  return {
    acquire() {
      if (references === 0) stop = start();
      references += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        references = Math.max(0, references - 1);
        if (references === 0) {
          stop?.();
          stop = null;
        }
      };
    },
    get count() {
      return references;
    },
  };
}
