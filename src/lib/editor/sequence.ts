/**
 * Run work one item at a time.
 * The editor uses this so a slow Ollama paragraph cannot overlap the next one.
 */

export async function runSequentially<T>(
  items: readonly T[],
  step: (item: T, index: number) => Promise<void>,
  stop: () => boolean = () => false
): Promise<void> {
  for (let index = 0; index < items.length; index += 1) {
    if (stop()) return;
    await step(items[index], index);
  }
}
